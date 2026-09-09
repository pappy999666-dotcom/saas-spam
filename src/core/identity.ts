/**
 * Identity normalization + LID policy (spec §29).
 *
 * LID / hosted-LID / device suffixes are internal transport details and must
 * never leak into user-facing output. Public output prefers, in order:
 *   1. @mention (rendered by the transport with a real JID)
 *   2. readable WhatsApp phone number
 *   3. display name (when the caller has one)
 *
 * Blueprint: pappy-omega-mini `identity-normalization.ts` (audited, proven).
 * Changes must keep the invariant: LID-only values are rejected as command
 * targets, never silently mapped to a guessed phone identity.
 */

const PHONE_JID_RE = /^(\d{7,15})@(s\.whatsapp\.net|c\.us)$/iu;
const DIGITS_RE = /^\d{7,15}$/;
const LID_RE = /@(?:lid|hosted\.lid)$/iu;

export function isLidIdentity(value: unknown): boolean {
  return typeof value === "string" && LID_RE.test(value.trim());
}

/** Extract verified phone digits from a JID, bare number, or formatted phone string. */
export function phoneDigitsFromIdentity(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  const jidMatch = PHONE_JID_RE.exec(normalized);
  if (jidMatch?.[1]) return jidMatch[1];
  if (DIGITS_RE.test(normalized)) return normalized;
  if (/^\+?[0-9][0-9\s().-]{6,20}$/.test(normalized)) {
    const formattedDigits = normalized.replace(/\D/g, "");
    if (DIGITS_RE.test(formattedDigits)) return formattedDigits;
  }
  return undefined;
}

export function phoneJidFromIdentity(value: unknown): string | undefined {
  const digits = phoneDigitsFromIdentity(value);
  return digits ? `${digits}@s.whatsapp.net` : undefined;
}

export function firstVerifiedPhone(...values: unknown[]): string | undefined {
  for (const value of values) {
    const digits = phoneDigitsFromIdentity(value);
    if (digits) return digits;
  }
  return undefined;
}

/**
 * User-facing label. Deliberately partial-masks the number: user-facing output
 * shows `+234•••1234` rather than internal JIDs or full raw numbers in lists.
 */
export function maskedPhoneLabel(digits: string | undefined, index?: number): string {
  const prefix = index === undefined ? "" : `#${index + 1} `;
  if (!digits) return `${prefix}Verified phone unavailable`;
  return `${prefix}+${digits.slice(0, 3)}\u2022\u2022\u2022${digits.slice(-4)}`;
}

/** Deduplicated, mention-safe phone JIDs for transport mention arrays. */
export function verifiedMentionJids(values: unknown[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => phoneJidFromIdentity(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/**
 * Resolve exactly one command target from explicit args, @mentions, or the
 * quoted sender (in that priority). LID-only values never resolve.
 */
export function verifiedTargetPhone(
  args: string[] | undefined,
  mentions: unknown[] | undefined,
  quotedSender: unknown,
): string | undefined {
  const mentioned = verifiedMentionJids(mentions);
  if (mentioned.length) return phoneDigitsFromIdentity(mentioned[0]);
  const quoted = phoneDigitsFromIdentity(quotedSender);
  if (quoted) return quoted;
  for (const arg of args ?? []) {
    const digits = phoneDigitsFromIdentity(arg);
    if (digits) return digits;
  }
  return undefined;
}

export function verifiedTargetJid(
  args: string[] | undefined,
  mentions: unknown[] | undefined,
  quotedSender: unknown,
): string | undefined {
  return phoneJidFromIdentity(verifiedTargetPhone(args, mentions, quotedSender));
}

/** Collect explicit + mentioned + quoted targets as deduplicated phone JIDs. */
export function verifiedTargetJids(
  args: string[] | undefined,
  mentions: unknown[] | undefined,
  quotedSender: unknown,
): string[] {
  const values = [
    ...(Array.isArray(mentions) ? mentions : []),
    ...(quotedSender ? [quotedSender] : []),
    ...(args ?? []),
  ];
  return [
    ...new Set(
      values
        .map((value) => phoneJidFromIdentity(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}
