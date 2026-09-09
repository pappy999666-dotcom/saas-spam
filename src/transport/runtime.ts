/**
 * WhatsApp runtime — binds registry sessions to live plogme sockets.
 *
 * Responsibilities: start/pair sessions, persist auth state per session,
 * maintain the socket map, reconnect with backoff on transient closes,
 * normalize inbound messages and hand them to the dispatcher. Session
 * state in the registry is always the mirror of observed transport truth.
 *
 * Pairing flow (reference-proven pattern from pappy-omega-mini):
 * fresh socket per attempt → wait for socket readiness → retry the code
 * request with bounded attempts. A stale socket's events can never act on a
 * newer generation (guards the replace-during-pairing race).
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WASocket } from "plogme";
import { env } from "../config/env.js";
import { ClassifiedError, classifyError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { SessionRegistry, type WhatsAppSession } from "../sessions/registry.js";
import { startSocket, type SocketHandle } from "./plogme-adapter.js";
import { socketMethod, type PlogmeSocketLike } from "./capabilities.js";
import { normalizeIncomingMessage, type NormalizedMessage } from "./normalizer.js";
import { dispatchWhatsAppMessage, type DispatchDeps, type DispatchResult } from "./dispatcher.js";
import { CommandRegistry, type ReplyPayload } from "../core/command-registry.js";
import type { PermissionScope } from "../core/permissions.js";

/** Auth-state cache store: JSON file per session (swap for Redis-backed in fleets). */
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
  generation: number;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
}

const MAX_RECONNECT_ATTEMPTS = 8;
const PAIRING_REQUEST_ATTEMPTS = 5;
const PAIRING_REQUEST_DELAY_MS = 2_000;
const SOCKET_READY_TIMEOUT_MS = 25_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WhatsAppRuntime {
  private readonly live = new Map<string, LiveSession>();
  private readonly generations = new Map<string, number>();
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

  private nextGeneration(sessionId: string): number {
    const next = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, next);
    return next;
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return this.generations.get(sessionId) === generation;
  }

  /** Hard-stop a live socket without scheduling reconnects (used before replace/logout). */
  private killLive(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    if (live.reconnectTimer) clearTimeout(live.reconnectTimer);
    try {
      live.handle.stop();
    } catch {
      // already closed
    }
    this.live.delete(sessionId);
  }

  /**
   * Pair a session: fresh socket, wait for readiness, then request the
   * 8-char code with bounded retries. Returns the code immediately once the
   * engine accepts it (Telegram shows it to the user).
   */
  async pairSession(workspaceId: string, sessionId: string, phoneNumber: string): Promise<{ pairingCode: string }> {
    this.registry.getSession(workspaceId, sessionId);
    // Replace any live socket first so the code belongs to THIS attempt and
    // stale close events cannot interfere (generation guard).
    this.nextGeneration(sessionId);
    this.killLive(sessionId);
    await rm(join(env.SESSION_ROOT, sessionId), { recursive: true, force: true }).catch(() => undefined);
    this.registry.updateSession(workspaceId, sessionId, { transportState: "pairing", phoneNumber });

    const generation = this.nextGeneration(sessionId);
    const store = new FileAuthStore(join(env.SESSION_ROOT, sessionId, "auth.json"));
    await store.load();

    const handle = await startSocket({
      phoneNumber,
      authStore: store,
      events: {
        onConnectionUpdate: (state) => {
          if (!this.isCurrent(sessionId, generation)) return;
          if (state.connection === "open") this.markOpen(sessionId);
          if (state.connection === "close") this.scheduleReconnect(workspaceId, sessionId, generation);
        },
      },
    });
    this.live.set(sessionId, { handle, generation, reconnectAttempts: 0 });
    this.wireInbound(sessionId, handle.socket, generation);

    await this.waitForSocketReady({ handle, generation, reconnectAttempts: 0 }, generation, SOCKET_READY_TIMEOUT_MS);

    const requestPairing = socketMethod<string>(handle.socket as PlogmeSocketLike, "requestPairingCode");
    let lastError: unknown;
    for (let attempt = 1; attempt <= PAIRING_REQUEST_ATTEMPTS; attempt += 1) {
      if (!this.isCurrent(sessionId, generation))
        throw new ClassifiedError("cancelled", "This pairing attempt was replaced by a newer one.");
      try {
        const code = await requestPairing(phoneNumber.replace(/\D/g, ""), env.PAIRING_CUSTOM_CODE);
        if (typeof code === "string" && code) {
          logger.info("Pairing code issued", { sessionId, attempt });
          return { pairingCode: code };
        }
        lastError = new Error("empty pairing code response");
      } catch (error) {
        lastError = error;
        logger.warn("Pairing code request failed; retrying", { sessionId, attempt, error: error instanceof Error ? error.message : String(error) });
      }
      await sleep(PAIRING_REQUEST_DELAY_MS);
    }
    throw classifyError(lastError ?? new Error("WhatsApp did not accept the pairing request."));
  }

  /** Resume an already-paired session from stored auth state (no code request). */
  async resumeSession(workspaceId: string, sessionId: string): Promise<void> {
    const session = this.registry.getSession(workspaceId, sessionId);
    if (!session.phoneNumber) return; // never paired; nothing to resume
    const generation = this.nextGeneration(sessionId);
    const store = new FileAuthStore(join(env.SESSION_ROOT, sessionId, "auth.json"));
    await store.load();
    const handle = await startSocket({
      phoneNumber: session.phoneNumber,
      authStore: store,
      events: {
        onConnectionUpdate: (state) => {
          if (!this.isCurrent(sessionId, generation)) return;
          if (state.connection === "open") this.markOpen(sessionId);
          if (state.connection === "close") this.scheduleReconnect(workspaceId, sessionId, generation);
        },
      },
    });
    this.live.set(sessionId, { handle, generation, reconnectAttempts: 0 });
    this.wireInbound(sessionId, handle.socket, generation);
  }

  stopSession(sessionId: string): void {
    this.nextGeneration(sessionId);
    this.killLive(sessionId);
    logger.info("Session stopped", { sessionId });
  }

  /** Resolve when the socket emits its first connection.update (WS is ready). */
  private waitForSocketReady(live: LiveSession, generation: number, timeoutMs: number): Promise<void> {
    const socket = live.handle.socket;
    const events = socket.ev as { on: (event: string, listener: (payload: unknown) => void) => void; off?: (event: string, listener: (payload: unknown) => void) => void } | undefined;
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        events?.off?.("connection.update", listener);
        resolve();
      };
      const listener = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      events?.on("connection.update", listener);
    });
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

  private scheduleReconnect(workspaceId: string, sessionId: string, generation: number): void {
    if (!this.isCurrent(sessionId, generation)) return; // stale socket event
    const live = this.live.get(sessionId);
    if (!live) return; // deliberately stopped (replace/logout) — no ghost reconnect
    this.registry.updateSession(workspaceId, sessionId, { transportState: "reconnecting" });
    this.live.delete(sessionId);
    if (live.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.registry.updateSession(workspaceId, sessionId, {
        transportState: "error",
        lastError: "Gave up reconnecting after repeated failures.",
      });
      logger.warn("Reconnect budget exhausted", { sessionId });
      return;
    }
    const attempts = live.reconnectAttempts + 1;
    const delayMs = Math.min(60_000, 1_000 * 2 ** (attempts - 1));
    const timer = setTimeout(() => {
      if (!this.isCurrent(sessionId, generation)) return;
      void this.resumeSession(workspaceId, sessionId).catch((error) => {
        const classified = classifyError(error);
        logger.warn("Reconnect failed", { sessionId, reason: classified.message });
        this.scheduleReconnect(workspaceId, sessionId, generation);
        const updated = this.live.get(sessionId);
        if (updated) updated.reconnectAttempts = attempts;
      });
    }, delayMs);
    timer.unref?.();
    this.live.set(sessionId, { handle: live.handle, generation, reconnectAttempts: attempts, reconnectTimer: timer });
  }

  /** Wire inbound message events → normalizer → dispatcher (generation-guarded). */
  private wireInbound(sessionId: string, socket: WASocket, generation: number): void {
    const events = socket.ev as { on: (event: string, listener: (payload: unknown) => void) => void } | undefined;
    events?.on("messages.upsert", (raw: unknown) => {
      if (!this.isCurrent(sessionId, generation)) return;
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
