/**
 * Permission resolution (spec §8, §31).
 *
 * Role ladder (checked top-down; first match wins):
 *   owner   — the Telegram user who owns the workspace
 *   sudo    — session-scoped sudo list
 *   global  — workspace-scoped sudo list
 *   none    — everyone else
 *
 * Deliberately data-driven and transport-agnostic: the same resolver serves
 * WhatsApp command routing and Telegram control-plane actions.
 */

export type Role = "owner" | "sudo" | "global" | "none";

export interface PermissionSubject {
  /** Verified phone digits for the acting WhatsApp identity (if known). */
  phoneDigits?: string;
  /** Telegram user id for control-plane actors. */
  telegramUserId?: string;
  /** True when the transport proves the message came from the paired account itself. */
  fromSelf?: boolean;
}

export interface PermissionScope {
  ownerTelegramUserId?: string;
  sessionSudoPhones: readonly string[];
  workspaceSudoPhones: readonly string[];
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function resolveRole(subject: PermissionSubject, scope: PermissionScope): Role {
  if (subject.fromSelf) return "owner";
  if (
    subject.telegramUserId !== undefined &&
    scope.ownerTelegramUserId !== undefined &&
    subject.telegramUserId === scope.ownerTelegramUserId
  )
    return "owner";
  const phone = subject.phoneDigits !== undefined ? normalizePhone(subject.phoneDigits) : undefined;
  if (phone) {
    if (scope.sessionSudoPhones.some((identity) => normalizePhone(identity) === phone)) return "sudo";
    if (scope.workspaceSudoPhones.some((identity) => normalizePhone(identity) === phone)) return "global";
  }
  return "none";
}

/** Commands marked ownerOnly reject sudo/global actors. */
export function canInvoke(role: Role, ownerOnly: boolean): boolean {
  if (!ownerOnly) return role !== "none";
  return role === "owner";
}
