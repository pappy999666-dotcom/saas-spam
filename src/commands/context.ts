/**
 * Command runtime services — the bridge between pure command handlers and
 * the transport/session/engine layers. Handlers receive this via an extended
 * context instead of importing singletons (keeps handlers testable).
 */

import type { WhatsAppSession } from "../sessions/registry.js";
import type { SessionRegistry } from "../sessions/registry.js";
import type { WASocket } from "plogme";
import type { OperationHandle } from "../core/operation-engine.js";

export interface CommandServices {
  registry: SessionRegistry;
  /** The live socket for this session, when connected. */
  socketFor: (sessionId: string) => WASocket | undefined;
  /** Start a bulk operation; the engine handles scheduling/retry/progress. */
  startBulk: (def: Parameters<typeof import("../core/operation-engine.js").startOperation>[0], exec: Parameters<typeof import("../core/operation-engine.js").startOperation>[1]) => OperationHandle;
  /** Re-dispatch a raw text as a command (used by self-chaining tags, §23). */
  dispatchText: (sessionId: string, chatJid: string, text: string) => Promise<void>;
}

declare module "../core/command-registry.js" {
  interface CommandContext {
    /** Runtime services (absent in pure unit tests). */
    services?: CommandServices;
    /** Resolved session snapshot. */
    session?: WhatsAppSession;
  }
}
