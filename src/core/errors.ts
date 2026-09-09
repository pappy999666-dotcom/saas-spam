/**
 * Structured failure classification (spec §44).
 *
 * Every operation step resolves to either success or a classified failure.
 * Retry policy is driven by `retryable`, never by string matching at call sites.
 */

export type FailureKind =
  | "network" // transient socket/HTTP issue
  | "timeout" // transient slow response
  | "rate_limited" // temporary; back off then retry
  | "invalid_target" // permanent: bad JID/link/identifier
  | "permission" // permanent for this actor/target
  | "not_present" // permanent: member absent, group gone, already-left
  | "unavailable" // destination locked/full/expired — do not hammer
  | "unsupported" // capability/payload not supported by transport
  | "cancelled" // user or policy requested cancellation
  | "unknown";

const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([
  "network",
  "timeout",
  "rate_limited",
]);

export class ClassifiedError extends Error {
  readonly kind: FailureKind;
  /** Machine-readable detail for logs/live views; never shown raw to users. */
  readonly detail: string | undefined;
  /** Suggested backoff before a retry (ms) when kind is retryable. */
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: FailureKind,
    message: string,
    options?: { detail?: string; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? {} : { cause: options.cause });
    this.name = "ClassifiedError";
    this.kind = kind;
    this.detail = options?.detail;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof ClassifiedError) return error;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  // Transport-level signals first (cheap, deterministic).
  if (/rate.?limit|too many|429|retry after/i.test(message))
    return new ClassifiedError("rate_limited", "Rate limited by the platform.", {
      detail: message,
      retryAfterMs: 30_000,
    });
  if (/timeout|timed?\s?out|etimedout|econnaborted/i.test(lower))
    return new ClassifiedError("timeout", "The operation timed out.", { detail: message });
  if (/econn|eai_again|enotfound|ehostunreach|enetunreach|epipe|socket|websocket|stream errored|connection closed|disconnected|network/i.test(lower))
    return new ClassifiedError("network", "A temporary network error occurred.", { detail: message });

  // WhatsApp domain signals (audited from pappy-omega-mini join/group error paths).
  if (/not\s?in\s?group|you are not a participant|forbidden|not an admin|administrator|not authorized/i.test(message))
    return new ClassifiedError("permission", "This action is not permitted for this session in the target.", { detail: message });
  if (/invite|link.*(invalid|expired|revoked)|code.*invalid|gone|410/i.test(message))
    return new ClassifiedError("invalid_target", "The target link or identifier is invalid or expired.", { detail: message });
  if (/full|locked|unavailable|banned|removed|blocked/i.test(lower))
    return new ClassifiedError("unavailable", "The destination is unavailable for this action.", { detail: message });
  if (/not\s?found|no such|does not exist|unknown jid|item not found/i.test(lower))
    return new ClassifiedError("invalid_target", "The target could not be found.", { detail: message });
  if (/unsupported|not supported|capability/i.test(lower))
    return new ClassifiedError("unsupported", "The transport does not support this action.", { detail: message });

  return new ClassifiedError("unknown", "The operation failed for an unrecognized reason.", { detail: message });
}

export function isRetryable(error: unknown): boolean {
  const classified = error instanceof ClassifiedError ? error : classifyError(error);
  return RETRYABLE_KINDS.has(classified.kind);
}

/** Human-facing one-liner. Never include stack traces or raw internals (spec §15). */
export function userMessage(error: unknown): string {
  return classifyError(error).message;
}
