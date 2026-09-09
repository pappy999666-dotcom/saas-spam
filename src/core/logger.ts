/**
 * Structured operation-log (spec §37).
 *
 * Long-running operations emit typed events, not raw strings. Renderers on
 * either platform (Telegram live view, WhatsApp summaries, future dashboards)
 * consume the same event stream. Events are retained in bounded memory per
 * operation; durable sinks can subscribe later without changing emitters.
 */

export type OperationEventType =
  | "operation_started"
  | "target_started"
  | "target_completed"
  | "target_skipped"
  | "target_failed"
  | "operation_progress"
  | "operation_cancelled"
  | "operation_completed";

export interface OperationEvent {
  type: OperationEventType;
  operationId: string;
  timestamp: number;
  /** Target identifier (JID/phone/invite) — internal; renderers redact. */
  targetId?: string;
  /** Human-facing target label (safe to show). */
  targetName?: string;
  durationMs?: number;
  message?: string;
  /** Structured counters snapshot at emit time. */
  counters?: OperationCounters;
}

/**
 * Emit draft: optional fields may be explicitly `undefined` at call sites;
 * they are stripped before the strict event is stored or dispatched.
 */
export type OperationEventDraft = {
  [K in keyof Omit<OperationEvent, "type" | "operationId" | "timestamp">]: OperationEvent[K] | undefined;
} & Pick<OperationEvent, "type" | "operationId" | "timestamp">;

export interface OperationCounters {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  cancelled: number;
}

type EventListener = (event: OperationEvent) => void;

const MAX_EVENTS_PER_OPERATION = 500;
const operations = new Map<string, OperationEvent[]>();
const listeners = new Set<EventListener>();

export function onOperationEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitOperationEvent(draft: OperationEventDraft): void {
  const event: OperationEvent = {
    type: draft.type,
    operationId: draft.operationId,
    timestamp: draft.timestamp,
    ...(draft.targetId !== undefined ? { targetId: draft.targetId } : {}),
    ...(draft.targetName !== undefined ? { targetName: draft.targetName } : {}),
    ...(draft.durationMs !== undefined ? { durationMs: draft.durationMs } : {}),
    ...(draft.message !== undefined ? { message: draft.message } : {}),
    ...(draft.counters !== undefined ? { counters: draft.counters } : {}),
  };
  const list = operations.get(event.operationId);
  if (list) {
    list.push(event);
    if (list.length > MAX_EVENTS_PER_OPERATION) list.splice(0, list.length - MAX_EVENTS_PER_OPERATION);
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener failures must never break operation execution.
    }
  }
}

export function recordOperationHistory(operationId: string): void {
  operations.set(operationId, []);
}

export function getOperationHistory(operationId: string): readonly OperationEvent[] {
  return operations.get(operationId) ?? [];
}

export function forgetOperationHistory(operationId: string): void {
  operations.delete(operationId);
}

/** Minimal leveled logger (pino-compatible shape; swap the sink in one place). */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function redactMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    redacted[key] = /token|secret|password|credential|auth/i.test(key) ? "[redacted]" : value;
  }
  return redacted;
}

export const logger: Logger = {
  info(message, meta) {
    console.log(`[saas-promoter] ${message}`, redactMeta(meta));
  },
  warn(message, meta) {
    console.warn(`[saas-promoter] ${message}`, redactMeta(meta));
  },
  error(message, meta) {
    console.error(`[saas-promoter] ${message}`, redactMeta(meta));
  },
};
