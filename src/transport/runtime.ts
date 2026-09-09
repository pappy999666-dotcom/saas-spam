/**
 * WhatsApp runtime — binds registry sessions to live plogme sockets.
 *
 * Responsibilities: start/pair sessions, persist auth state per session,
 * maintain the socket map, reconnect with backoff on transient closes,
 * normalize inbound messages and hand them to the dispatcher. Session
 * state in the registry is always the mirror of observed transport truth.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WASocket } from "plogme";
import { env } from "../config/env.js";
import { classifyError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { SessionRegistry, type WhatsAppSession } from "../sessions/registry.js";
import { startSocket, type SocketHandle } from "./plogme-adapter.js";
import { normalizeIncomingMessage, type NormalizedMessage } from "./normalizer.js";
import { dispatchWhatsAppMessage, type DispatchDeps, type DispatchResult } from "./dispatcher.js";
import { CommandRegistry, type ReplyPayload } from "../core/command-registry.js";
import type { PermissionScope } from "../core/permissions.js";

/** Auth-state cache store: JSON file per session (swap for Redis/Redis-backed in fleets). */
class FileAuthStore {
  private data: Record<string, unknown> = {};
  constructor(private readonly filePath: string) {}
  async load(): Promise<void> {
    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, unknown>;
    } catch {
      this.data = {};
    }
  }
  async get(key: string): Promise<unknown> {
    return this.data[key];
  }
  async set(key: string, value: unknown): Promise<unknown> {
    this.data[key] = value;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data), "utf8");
    return value;
  }
  async delete(key: string): Promise<boolean> {
    const existed = key in this.data;
    delete this.data[key];
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data), "utf8");
    return existed;
  }
  async keys(pattern?: string): Promise<string[]> {
    const all = Object.keys(this.data);
    if (!pattern) return all;
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`, "u");
    return all.filter((key) => regex.test(key));
  }
  async reset(): Promise<void> {
    this.data = {};
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data), "utf8");
  }
}

interface LiveSession {
  handle: SocketHandle;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
}

const MAX_RECONNECT_ATTEMPTS = 8;

export class WhatsAppRuntime {
  private readonly live = new Map<string, LiveSession>();
  private dispatcherDeps?: (session: WhatsAppSession, replyChatJid: string) => DispatchDeps | undefined;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly commandRegistry: CommandRegistry,
  ) {}

  /** The control plane registers how commands dispatch for a session. */
  setDispatcher(factory: (session: WhatsAppSession, replyChatJid: string) => DispatchDeps | undefined): void {
    this.dispatcherDeps = factory;
  }

  socketFor(sessionId: string): WASocket | undefined {
    return this.live.get(sessionId)?.handle.socket;
  }

  listLive(): string[] {
    return [...this.live.keys()];
  }

  /**
   * Pair a session: starts the socket with the configured custom code and
   * returns the pairing code immediately (Telegram shows it to the user).
   */
  async pairSession(workspaceId: string, sessionId: string, phoneNumber: string): Promise<{ pairingCode: string }> {
    const session = this.registry.getSession(workspaceId, sessionId);
    this.registry.updateSession(workspaceId, sessionId, { transportState: "pairing", phoneNumber });

    const store = new FileAuthStore(join(env.SESSION_ROOT, sessionId, "auth.json"));
    await store.load();

    let pairingCodeIssued = "";
    const handle = await startSocket({
      phoneNumber,
      authStore: store,
      customPairingCode: env.PAIRING_CUSTOM_CODE,
      events: {
        onPairingCode: (code) => {
          pairingCodeIssued = code;
        },
        onConnectionUpdate: (state) => {
          if (state.connection === "open") this.markOpen(sessionId);
          if (state.connection === "close") this.scheduleReconnect(workspaceId, sessionId);
        },
      },
      waitForOpen: false,
    });

    this.live.set(sessionId, { handle, reconnectAttempts: 0 });
    this.wireInbound(sessionId, handle.socket);

    // Wait briefly for the code event if the request path didn't surface it yet.
    const deadline = Date.now() + 15_000;
    while (!pairingCodeIssued && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    if (!pairingCodeIssued) pairingCodeIssued = env.PAIRING_CUSTOM_CODE;

    logger.info("Pairing code issued", { sessionId });
    return { pairingCode: pairingCodeIssued };
  }

  async resumeSession(workspaceId: string, sessionId: string): Promise<void> {
    const session = this.registry.getSession(workspaceId, sessionId);
    if (!session.phoneNumber) return; // never paired; nothing to resume
    const store = new FileAuthStore(join(env.SESSION_ROOT, sessionId, "auth.json"));
    await store.load();
    const handle = await startSocket({
      phoneNumber: session.phoneNumber,
      authStore: store,
      events: {
        onConnectionUpdate: (state) => {
          if (state.connection === "open") this.markOpen(sessionId);
          if (state.connection === "close") this.scheduleReconnect(workspaceId, sessionId);
        },
      },
      waitForOpen: false,
    });
    this.live.set(sessionId, { handle, reconnectAttempts: 0 });
    this.wireInbound(sessionId, handle.socket);
  }

  stopSession(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    if (live.reconnectTimer) clearTimeout(live.reconnectTimer);
    live.handle.stop();
    this.live.delete(sessionId);
    logger.info("Session stopped", { sessionId });
  }

  private markOpen(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (live) live.reconnectAttempts = 0;
    for (const workspace of this.registry.listWorkspaces()) {
      for (const session of this.registry.listSessions(workspace.workspaceId)) {
        if (session.sessionId !== sessionId) continue;
        this.registry.updateSession(workspace.workspaceId, sessionId, {
          transportState: "connected",
          connectedAt: Date.now(),
        });
        logger.info("Session connected", { sessionId });
        return;
      }
    }
  }

  private scheduleReconnect(workspaceId: string, sessionId: string): void {
    const live = this.live.get(sessionId);
    this.registry.updateSession(workspaceId, sessionId, { transportState: "reconnecting" });
    if (!live) return;
    this.live.delete(sessionId);
    if (live.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.registry.updateSession(workspaceId, sessionId, {
        transportState: "error",
        lastError: "Gave up reconnecting after repeated failures.",
      });
      logger.warn("Reconnect budget exhausted", { sessionId });
      return;
    }
    const delayMs = Math.min(60_000, 1_000 * 2 ** live.reconnectAttempts);
    const timer = setTimeout(() => {
      void this.resumeSession(workspaceId, sessionId).catch((error) => {
        const classified = classifyError(error);
        logger.warn("Reconnect failed", { sessionId, reason: classified.message });
        const next = this.live.get(sessionId);
        const attempts = (next?.reconnectAttempts ?? live.reconnectAttempts) + 1;
        this.scheduleReconnect(workspaceId, sessionId);
        const updated = this.live.get(sessionId);
        if (updated) updated.reconnectAttempts = attempts;
      });
    }, delayMs);
    this.live.set(sessionId, { handle: live.handle, reconnectAttempts: live.reconnectAttempts + 1, reconnectTimer: timer });
  }

  /** Wire inbound message events → normalizer → dispatcher. */
  private wireInbound(sessionId: string, socket: WASocket): void {
    const events = socket.ev as { on: (event: string, listener: (payload: unknown) => void) => void } | undefined;
    events?.on("messages.upsert", (raw: unknown) => {
      const upsert = (raw ?? {}) as { messages?: Array<Record<string, unknown>> };
      for (const rawMessage of upsert.messages ?? []) {
        const normalized = normalizeIncomingMessage(rawMessage as never);
        if (!normalized.text.trim() && !normalized.media) continue;
        void this.dispatch(sessionId, normalized).catch((error) => {
          logger.warn("Dispatch failed", { sessionId, error: error instanceof Error ? error.message : String(error) });
        });
      }
    });
  }

  private async dispatch(sessionId: string, message: NormalizedMessage): Promise<DispatchResult> {
    if (!this.dispatcherDeps) return { handled: false, reason: "no_command" };
    for (const workspace of this.registry.listWorkspaces()) {
      const sessions = this.registry.listSessions(workspace.workspaceId);
      const session = sessions.find((candidate) => candidate.sessionId === sessionId);
      if (!session) continue;
      const deps = this.dispatcherDeps(session, message.chatJid);
      if (!deps) return { handled: false, reason: "no_command" };
      return dispatchWhatsAppMessage(message, deps);
    }
    return { handled: false, reason: "no_command" };
  }
}

/**
 * Default dispatcher factory: prefix from session settings, replies delivered
 * through the session's socket to the chat the command came from.
 */
export function buildDispatcherFactory(
  registry: SessionRegistry,
  commandRegistry: CommandRegistry,
  runtime: WhatsAppRuntime,
  permissionScopeFor: (workspaceId: string) => PermissionScope,
) {
  return (session: WhatsAppSession, replyChatJid: string): DispatchDeps | undefined => {
    const socket = runtime.socketFor(session.sessionId);
    if (!socket) return undefined;
    return {
      registry: commandRegistry,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      prefixConfig: { prefix: session.settings.prefix, prefixMode: session.settings.prefixMode },
      permissionScope: permissionScopeFor(session.workspaceId),
      leaseAdmits: (chatJid: string) => registry.leaseAdmits(session.workspaceId, session.sessionId, chatJid),
      reply: async (payload: ReplyPayload) => {
        const { sendText } = await import("./plogme-adapter.js");
        await sendText(socket, replyChatJid, payload.text ?? "", {
          ...(payload.mentions?.length ? { mentions: payload.mentions } : {}),
        });
      },
    };
  };
}
