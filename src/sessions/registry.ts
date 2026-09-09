/**
 * Session + workspace registry.
 *
 * Sessions are per-workspace WhatsApp accounts with their own settings,
 * transport state, and listening leases (§30). The registry is the single
 * source of truth; transports and planes read through it, never around it.
 * Persistence is injected (a JSON file store ships for dev; Mongo/Redis can
 * replace it without touching call sites).
 */

import { randomUUID } from "node:crypto";
import {
  defaultSessionSettings,
  type SessionSettings,
  type WorkspaceSettings,
  defaultWorkspaceSettings,
} from "./settings.js";
import type { PrefixConfig } from "../core/command-parser.js";

export type SessionTransportState =
  | "unpaired"
  | "pairing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "logged_out"
  | "error";

export interface ListeningLease {
  /** Chat JID the lease is scoped to. */
  chatJid: string;
  purpose: string;
  expiresAt: number;
}

export interface WhatsAppSession {
  sessionId: string;
  workspaceId: string;
  name: string;
  phoneNumber?: string;
  transportState: SessionTransportState;
  settings: SessionSettings;
  activeLease: ListeningLease | undefined;
  createdAt: number;
  connectedAt?: number;
  lastError?: string;
}

export interface Workspace {
  workspaceId: string;
  ownerTelegramUserId: string;
  settings: WorkspaceSettings;
  createdAt: number;
}

export interface RegistryPersistence {
  saveSession(session: WhatsAppSession): Promise<void> | void;
  saveWorkspace(workspace: Workspace): Promise<void> | void;
  loadAll(): Promise<{ sessions: WhatsAppSession[]; workspaces: Workspace[] }>;
}

/** In-memory persistence used in tests; real deployments inject file/db. */
export class InMemoryPersistence implements RegistryPersistence {
  readonly sessions = new Map<string, WhatsAppSession>();
  readonly workspaces = new Map<string, Workspace>();
  saveSession(session: WhatsAppSession): void {
    this.sessions.set(session.sessionId, structuredClone(session));
  }
  saveWorkspace(workspace: Workspace): void {
    this.workspaces.set(workspace.workspaceId, structuredClone(workspace));
  }
  async loadAll(): Promise<{ sessions: WhatsAppSession[]; workspaces: Workspace[] }> {
    return { sessions: [...this.sessions.values()], workspaces: [...this.workspaces.values()] };
  }
}

export class SessionRegistry {
  private readonly sessions = new Map<string, WhatsAppSession>();
  private readonly workspaces = new Map<string, Workspace>();

  constructor(private readonly persistence: RegistryPersistence = new InMemoryPersistence()) {}

  async hydrate(): Promise<void> {
    const { sessions, workspaces } = await this.persistence.loadAll();
    for (const workspace of workspaces) this.workspaces.set(workspace.workspaceId, workspace);
    for (const session of sessions) {
      // Sessions never restore as "connected" — the transport must prove it.
      this.sessions.set(session.sessionId, {
        ...session,
        transportState: session.transportState === "connected" ? "reconnecting" : session.transportState,
        activeLease: undefined,
      });
    }
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
    return workspace;
  }

  createWorkspace(ownerTelegramUserId: string): Workspace {
    const workspace: Workspace = {
      workspaceId: randomUUID(),
      ownerTelegramUserId,
      settings: defaultWorkspaceSettings(),
      createdAt: Date.now(),
    };
    this.workspaces.set(workspace.workspaceId, workspace);
    void this.persistence.saveWorkspace(workspace);
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()];
  }

  getSession(workspaceId: string, sessionId: string): WhatsAppSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId)
      throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  createSession(workspaceId: string, name: string): WhatsAppSession {
    this.getWorkspace(workspaceId); // existence check
    const session: WhatsAppSession = {
      sessionId: randomUUID(),
      workspaceId,
      name,
      transportState: "unpaired",
      settings: defaultSessionSettings(),
      activeLease: undefined,
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    void this.persistence.saveSession(session);
    return session;
  }

  listSessions(workspaceId: string): WhatsAppSession[] {
    return [...this.sessions.values()].filter((session) => session.workspaceId === workspaceId);
  }

  updateSession(
    workspaceId: string,
    sessionId: string,
    patch: Partial<Pick<WhatsAppSession, "name" | "phoneNumber" | "transportState" | "connectedAt" | "lastError" | "settings">>,
  ): WhatsAppSession {
    const session = this.getSession(workspaceId, sessionId);
    const next: WhatsAppSession = { ...session, ...patch };
    this.sessions.set(sessionId, next);
    void this.persistence.saveSession(next);
    return next;
  }

  updatePrefixConfig(workspaceId: string, sessionId: string, prefixConfig: PrefixConfig): WhatsAppSession {
    const session = this.getSession(workspaceId, sessionId);
    return this.updateSession(workspaceId, sessionId, {
      settings: { ...session.settings, prefix: prefixConfig.prefix, prefixMode: prefixConfig.prefixMode },
    });
  }

  deleteSession(workspaceId: string, sessionId: string): void {
    this.getSession(workspaceId, sessionId);
    this.sessions.delete(sessionId);
    // Persistence layers tombstone via their own mechanisms (future: status flag).
  }

  // ---- Listening leases (§30) ----

  grantLease(workspaceId: string, sessionId: string, chatJid: string, purpose: string, durationMs: number): ListeningLease {
    const session = this.getSession(workspaceId, sessionId);
    const lease: ListeningLease = { chatJid, purpose, expiresAt: Date.now() + Math.max(5_000, durationMs) };
    this.sessions.set(sessionId, { ...session, activeLease: lease });
    void this.persistence.saveSession(this.sessions.get(sessionId)!);
    return lease;
  }

  revokeLease(workspaceId: string, sessionId: string): void {
    const session = this.getSession(workspaceId, sessionId);
    this.sessions.set(sessionId, { ...session, activeLease: undefined });
    void this.persistence.saveSession(this.sessions.get(sessionId)!);
  }

  /** Is command processing for this chat admitted by an active lease? */
  leaseAdmits(workspaceId: string, sessionId: string, chatJid: string, now = Date.now()): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return false;
    const lease = session.activeLease;
    if (!lease) return false;
    if (lease.expiresAt <= now || lease.chatJid !== chatJid) return false;
    return true;
  }
}
