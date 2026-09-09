/**
 * Group command family (Phase 4, spec §9–§14, §30, §33, §42).
 * All handlers return renderer cards; all transport calls go through the
 * capability-gated adapter; identity resolution goes through core/identity.
 */

import { renderCard, type ResponseCard } from "../ui/renderer.js";
import { phoneJidFromIdentity, verifiedTargetJids } from "../core/identity.js";
import { userMessage } from "../core/errors.js";
import type { CommandDefinition, CommandRegistry, ReplyPayload } from "../core/command-registry.js";
import { parseDurationMs } from "./parse-duration.js";
import { MAX_CHAIN_DEPTH } from "../core/command-parser.js";

function requireGroup(ctx: { chatJid?: string }): string {
  if (!ctx.chatJid?.endsWith("@g.us")) throw new Error("This command works inside a WhatsApp group.");
  return ctx.chatJid;
}

function requireSocket(ctx: { services?: { socketFor: (sessionId: string) => import("plogme").WASocket | undefined }; sessionId: string }): import("plogme").WASocket {
  const socket = ctx.services?.socketFor(ctx.sessionId);
  if (!socket) throw new Error("This session is not connected. Pair or reconnect first.");
  return socket;
}

async function runCommand(ctx: Parameters<CommandDefinition["run"]>[0], fn: () => Promise<ResponseCard | ReplyPayload | string>): Promise<ResponseCard | ReplyPayload | string> {
  try {
    return await fn();
  } catch (error) {
    return renderCard.error(ctx.command, userMessage(error), { next: [`${ctx.prefixConfig.prefix}menu`] });
  }
}

export function registerGroupCommands(registry: CommandRegistry): void {
  // ---- Menu (§9) ----
  registry.register({
    name: "menu",
    aliases: ["list"],
    category: "utilities",
    description: "Show available commands by category.",
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const categories = ["groups", "members", "status", "messaging", "automation", "media", "sessions", "utilities"] as const;
        const rows = categories
          .map((category) => {
            const commands = registry.list(category).filter((command) => !command.ownerOnly || ctx.senderRole === "owner");
            return commands.length ? { label: category as string, value: commands.map((command) => command.name).join(", ") } : undefined;
          })
          .filter((row): row is { label: string; value: string } => row !== undefined);
        return renderCard.status("SaaS Promoter", `Prefix: ${ctx.prefixConfig.prefix || "none"}`, rows, {
          footer: `${registry.list().length} commands available.`,
        });
      }),
  });

  // ---- Create group (§10) ----
  registry.register({
    name: "creategc",
    aliases: ["cgc"],
    category: "groups",
    description: "Create a WhatsApp group with a guided flow.",
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const name = ctx.args.join(" ").trim();
        if (!name) return renderCard.error("Create group", "Provide a group name.", { next: ["creategc <name>"] });
        const socket = requireSocket(ctx);
        const { groupCreate } = await import("../transport/plogme-adapter.js");
        const result = await groupCreate(socket, name, []);
        const card = renderCard.status("Group created", name, [
          { label: "Members", value: "1 (you)" },
          { label: "Invite", value: "use .glink to get the invite link" },
        ], { buttons: [{ id: "group:configure", text: "Configure", style: "neutral" }] });
        void result;
        return card;
      }),
  });

  // ---- Invite link ----
  registry.register({
    name: "glink",
    aliases: ["invite"],
    category: "groups",
    description: "Get the current group's invite link.",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const jid = requireGroup(ctx);
        const socket = requireSocket(ctx);
        const { groupInviteCode } = await import("../transport/plogme-adapter.js");
        const code = await groupInviteCode(socket, jid);
        return renderCard.status("Invite link", `https://chat.whatsapp.com/${code}`, [{ label: "Group", value: jid.split("@")[0] ?? jid }]);
      }),
  });

  // ---- Leave (§11) with native confirmation for current group ----
  registry.register({
    name: "leavegc",
    aliases: ["leave", "lve", "lvgc"],
    category: "groups",
    description: "Leave the current group (confirmation required).",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        requireGroup(ctx);
        return renderCard.status("Leave group", "Are you sure?", [
          { label: "Action", value: "This session will leave this group permanently." },
        ], {
          buttons: [
            { id: "group:leave:confirm", text: "Yes, leave", style: "confirm" },
            { id: "group:leave:cancel", text: "Cancel", style: "cancel" },
          ],
        });
      }),
  });

  registry.register({
    name: "leaveall",
    aliases: ["lvall"],
    category: "groups",
    description: "Leave every eligible group (confirmation + live progress).",
    run: async (ctx) =>
      runCommand(ctx, async () =>
        renderCard.status("Leave all groups", "Are you sure?", [
          { label: "Action", value: "The session leaves every group it participates in. This cannot be undone." },
        ], {
          buttons: [
            { id: "group:leaveall:confirm", text: "Yes, leave all", style: "confirm" },
            { id: "group:leaveall:cancel", text: "Cancel", style: "cancel" },
          ],
        }),
      ),
  });

  // ---- Promote / Demote (§12) ----
  const memberAction = (action: "promote" | "demote"): CommandDefinition => ({
    name: action === "promote" ? "pmt" : "dmt",
    aliases: action === "promote" ? ["promote"] : ["demote"],
    category: "members",
    description: action === "promote" ? "Promote a member to admin." : "Demote an admin.",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const jid = requireGroup(ctx);
        const socket = requireSocket(ctx);
        const targets = verifiedTargetJids(ctx.args, ctx.mentions, ctx.quoted?.senderJid);
        if (!targets.length) return renderCard.error(action, "Tag the member or reply to their message.", { next: [`${ctx.prefixConfig.prefix}${action} @member`] });
        const { groupParticipantsUpdate } = await import("../transport/plogme-adapter.js");
        const results = await groupParticipantsUpdate(socket, jid, targets, action);
        const failed = results.filter((result) => result.error);
        return renderCard.status(
          action === "promote" ? "Promotion" : "Demotion",
          `${results.length - failed.length}/${results.length} applied`,
          results.map((result, index) => ({ label: `#${index + 1}`, value: result.error ? `failed: ${result.error}` : "applied" })),
        );
      }),
  });
  registry.register(memberAction("promote"));
  registry.register(memberAction("demote"));

  // ---- Smart promote (§13) ----
  registry.register({
    name: "spmt",
    aliases: [],
    category: "members",
    description: "Promote a member if present; otherwise explain the limitation.",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const jid = requireGroup(ctx);
        const socket = requireSocket(ctx);
        const targets = verifiedTargetJids(ctx.args, ctx.mentions, ctx.quoted?.senderJid);
        if (!targets.length) return renderCard.error("Smart promote", "Tag the member or reply to their message.");
        const { groupMetadata, groupParticipantsUpdate } = await import("../transport/plogme-adapter.js");
        const metadata = await groupMetadata(socket, jid);
        const present = metadata.participants.filter((participant) => targets.includes(participant.id));
        if (!present.length)
          return renderCard.error("Smart promote", "That member is not in this group, so they cannot be promoted directly.", {
            next: ["add them first, then run .spmt again"],
          });
        const results = await groupParticipantsUpdate(socket, jid, present.map((participant) => participant.id), "promote");
        return renderCard.status("Smart promote", `${results.filter((result) => !result.error).length} promoted`, metadata.participants
          .filter((participant) => present.some((p) => p.id === participant.id))
          .map((participant) => ({ label: "Member", value: participant.phoneNumber ? `+${participant.phoneNumber.replace(/\D/g, "")}` : "member" })));
      }),
  });

  // ---- Smart demote (§14) — no code flow needed ----
  registry.register({
    name: "sdmt",
    aliases: [],
    category: "members",
    description: "Demote an admin; explains when the target is not an admin.",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const jid = requireGroup(ctx);
        const socket = requireSocket(ctx);
        const targets = verifiedTargetJids(ctx.args, ctx.mentions, ctx.quoted?.senderJid);
        if (!targets.length) return renderCard.error("Smart demote", "Tag the admin or reply to their message.");
        const { groupMetadata, groupParticipantsUpdate } = await import("../transport/plogme-adapter.js");
        const metadata = await groupMetadata(socket, jid);
        const admins = metadata.participants.filter((participant) => participant.admin && targets.includes(participant.id));
        if (!admins.length)
          return renderCard.error("Smart demote", "That member is not an admin in this group.");
        const results = await groupParticipantsUpdate(socket, jid, admins.map((participant) => participant.id), "demote");
        return renderCard.status("Smart demote", `${results.filter((result) => !result.error).length} demoted`, []);
      }),
  });

  // ---- Listening lease (§30) ----
  registry.register({
    name: "listen",
    aliases: [],
    category: "utilities",
    description: "Enable command listening in this group for a duration (e.g. .listen 5m).",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const jid = requireGroup(ctx);
        const token = ctx.args[0] ?? "5m";
        const durationMs = parseDurationMs(token);
        if (!durationMs) return renderCard.error("Listen", "Provide a duration like 10m or 1h (max 1h).");
        const lease = ctx.services?.registry.grantLease(ctx.workspaceId, ctx.sessionId, jid, "command", Math.min(durationMs, 60 * 60_000));
        const minutes = lease ? Math.round((lease.expiresAt - Date.now()) / 60_000) : 0;
        return renderCard.status("Listening enabled", `${minutes} min in this group`, [
          { label: "Scope", value: "This group only" },
          { label: "Expiry", value: new Date(lease!.expiresAt).toISOString().slice(11, 16) + " UTC" },
        ], { footer: "Sending is always available; listening is scoped and temporary." });
      }),
  });

  // ---- Prefix settings (§6, §33) ----
  registry.register({
    name: "setprefix",
    aliases: [],
    category: "sessions",
    description: "Set this session's command prefix (.setprefix ! | none).",
    run: async (ctx) =>
      runCommand(ctx, async () => {
        const requested = ctx.args[0]?.trim();
        if (requested === undefined) {
          const current = ctx.session?.settings;
          return renderCard.status("Prefix", current ? (current.prefix || "none") : ".", [
            { label: "Mode", value: current?.prefixMode ?? "required" },
            { label: "Usage", value: `${ctx.prefixConfig.prefix}setprefix <char|none>` },
          ]);
        }
        if (requested.toLowerCase() === "none") {
          ctx.services?.registry.updatePrefixConfig(ctx.workspaceId, ctx.sessionId, { prefix: "", prefixMode: "none" });
          return renderCard.status("Prefix", "none (prefixless)", [{ label: "Note", value: "Only known command names are recognized." }]);
        }
        const prefix = requested.slice(0, 3);
        ctx.services?.registry.updatePrefixConfig(ctx.workspaceId, ctx.sessionId, { prefix, prefixMode: "required" });
        return renderCard.status("Prefix", prefix, [{ label: "Mode", value: "required" }]);
      }),
  });

  // ---- Group picture (§42) ----
  registry.register({
    name: "setgpp",
    aliases: [],
    category: "media",
    description: "Set this group's picture (reply to an image).",
    groupOnly: true,
    run: async (ctx) =>
      runCommand(ctx, async () => {
        requireGroup(ctx);
        if (!ctx.media || ctx.media.kind !== "image")
          return renderCard.error("Set group picture", "Reply to an image with this command.");
        return renderCard.error("Set group picture", "Media bytes must be resolved by the runtime media resolver before this command can run in production.", {
          next: ["attach media support to the session runtime"],
        });
      }),
  });
}

export { MAX_CHAIN_DEPTH };
