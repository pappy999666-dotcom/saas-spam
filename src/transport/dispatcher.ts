/**
 * Dispatch pipeline (spec §8):
 *   normalized message → prefix resolver → parser → permission resolver →
 *   handler → reply payload. WhatsApp is a private command surface (§5):
 *   unauthorized senders are ignored silently, and group listening is
 *   lease-gated (§30) except for explicit commands from the paired account.
 */

import { canonicalCommandName, parseCommand, type PrefixConfig } from "../core/command-parser.js";
import { CommandRegistry, type CommandContext, type ReplyPayload } from "../core/command-registry.js";
import { resolveRole, canInvoke, type PermissionScope, type PermissionSubject } from "../core/permissions.js";
import type { NormalizedMessage } from "./normalizer.js";

export interface DispatchDeps {
  registry: CommandRegistry;
  workspaceId: string;
  sessionId: string;
  prefixConfig: PrefixConfig;
  permissionScope: PermissionScope;
  /** Lease gate for non-command group traffic (§30). */
  leaseAdmits: (chatJid: string) => boolean;
  reply: (payload: ReplyPayload) => Promise<void>;
  /** Commands may dispatch child operations; injected by the runtime. */
  onCommand?: (command: string, ctx: CommandContext) => void;
}

export type DispatchResult = { handled: true } | { handled: false; reason: "no_command" | "unauthorized" | "lease_closed" | "group_only" | "unknown_command" };

export async function dispatchWhatsAppMessage(
  message: NormalizedMessage,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const text = message.text.trim();
  if (!text) return { handled: false, reason: "no_command" };

  // Parsing: configured prefix, or (bridge-style) bare known names in
  // optional/none modes. Required mode ignores unrelated conversation.
  const knownNames = deps.registry.knownNames;
  const prefixed = parseCommand({ text, prefixConfig: deps.prefixConfig, knownNames });
  const bare =
    prefixed === null && deps.prefixConfig.prefixMode !== "required" && message.fromMe
      ? parseCommand({ text, prefixConfig: { prefix: "", prefixMode: "none" }, knownNames })
      : undefined;
  const parsed = prefixed ?? bare;
  if (!parsed) return { handled: false, reason: "no_command" };

  const canonical = canonicalCommandName(parsed.name, deps.registry.aliasMap);
  const definition = deps.registry.resolve(canonical);
  if (!definition) return { handled: false, reason: "unknown_command" };

  // Permission resolution (§8): transport-proven self counts as owner.
  const extractedDigits = message.senderJid.split("@")[0]?.replace(/\D/g, "");
  const subject: PermissionSubject = {
    fromSelf: message.fromMe,
    ...(extractedDigits ? { phoneDigits: extractedDigits } : {}),
  };
  const role = resolveRole(subject, deps.permissionScope);
  if (!canInvoke(role, definition.ownerOnly === true)) return { handled: false, reason: "unauthorized" };

  // Group-only commands (moderation etc.) never act outside groups.
  if (definition.groupOnly && !message.isGroup) return { handled: false, reason: "group_only" };

  // Listening gate (§30): in groups, non-self traffic requires a lease.
  if (message.isGroup && !message.fromMe && !deps.leaseAdmits(message.chatJid))
    return { handled: false, reason: "lease_closed" };

  const ctx: CommandContext = {
    platform: "whatsapp",
    workspaceId: deps.workspaceId,
    sessionId: deps.sessionId,
    chatJid: message.chatJid,
    senderJid: message.senderJid,
    senderRole: role,
    command: canonical,
    args: parsed.args,
    rawPayload: parsed.rawPayload,
    prefixConfig: deps.prefixConfig,
    mentions: message.mentions,
    ...(message.quoted ? { quoted: message.quoted } : {}),
    ...(message.media ? { media: message.media } : {}),
    ...(message.messageId ? { operationId: message.messageId } : {}),
    reply: deps.reply,
  };

  deps.onCommand?.(canonical, ctx);
  const result = await definition.run(ctx);
  if (typeof result === "string") {
    if (result) await deps.reply({ text: result, ...(message.mentions.length ? { mentions: message.mentions } : {}) });
  } else {
    await deps.reply(result);
  }
  return { handled: true };
}
