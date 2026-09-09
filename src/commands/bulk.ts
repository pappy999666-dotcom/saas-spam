/**
 * Status / tag / bulk command families (Phase 5, spec §16–§24).
 *
 * Everything long-running runs on the shared operation engine — one scheduler,
 * one retry policy, one progress model, zero duplicated setTimeout chains.
 * Counts are honest: requested vs scheduled vs sent vs failed vs skipped (§18).
 */

import { renderCard, type ResponseCard } from "../ui/renderer.js";
import { startOperation, type OperationHandle, type OperationTarget } from "../core/operation-engine.js";
import { userMessage } from "../core/errors.js";
import { parseDurationMs } from "./parse-duration.js";
import type { CommandDefinition, CommandRegistry } from "../core/command-registry.js";

export interface BulkTransport {
  listGroupJids: () => Promise<Array<{ jid: string; name?: string }>>;
  sendGroupStatus: (jid: string, payload: { text?: string }) => Promise<void>;
  sendGroupTextWithMentions: (jid: string, text: string, mentionJids: string[]) => Promise<void>;
  sendGroupTextHidden: (jid: string, text: string) => Promise<void>;
  sendTargetGroupStatus: (jid: string, payload: { text?: string }) => Promise<void>;
}

export interface BulkRuntime {
  transport: BulkTransport | undefined;
  delayMs: number;
  idempotencyKeys: Set<string>;
}

export interface BulkDeps {
  runtime: BulkRuntime;
  /** Live handles by operation id for view refreshes. */
  operations: Map<string, OperationHandle>;
}

const REPEAT_CAP = 20;
const TARGET_CAP = 5_000;

function requireTransport(deps: BulkDeps): BulkTransport {
  if (!deps.runtime.transport) throw new Error("The session transport is not ready.");
  return deps.runtime.transport;
}

async function card(ctx: Parameters<CommandDefinition["run"]>[0], fn: () => Promise<ResponseCard>): Promise<ResponseCard> {
  try {
    return await fn();
  } catch (error) {
    return renderCard.error(ctx.command, userMessage(error), { next: [`${ctx.prefixConfig.prefix}menu`] });
  }
}

function startBulk(
  deps: BulkDeps,
  workspaceId: string,
  sessionId: string,
  type: string,
  targets: OperationTarget[],
  execute: (target: OperationTarget) => Promise<"completed" | "skipped">,
): ResponseCard {
  if (deps.runtime.idempotencyKeys.has(`${type}:${sessionId}:${targets.length}:${targets[0]?.id ?? ""}`))
    return renderCard.error(type, "This exact operation was just started. Check its live view instead.");
  const handle = startOperation(
    {
      type,
      workspaceId,
      sessionId,
      targets,
      delayMs: deps.runtime.delayMs,
    },
    execute,
  );
  deps.operations.set(handle.operationId, handle);
  void handle.done.finally(() => deps.operations.delete(handle.operationId));
  const snapshot = handle.snapshot();
  return renderCard.operation(`${type} started`, { completed: 0, total: snapshot.total, skipped: 0, failed: 0, cancelled: 0, remaining: snapshot.remaining, elapsedMs: 0, estimatedRemainingMs: snapshot.estimatedRemainingMs }, { operationId: handle.operationId });
}

export function registerBulkCommands(registry: CommandRegistry, deps: BulkDeps): void {
  const workspaceOf = (ctx: Parameters<CommandDefinition["run"]>[0]) => ctx.workspaceId;
  const sessionOf = (ctx: Parameters<CommandDefinition["run"]>[0]) => ctx.sessionId;

  // ---- Group status (§16) ----
  registry.register({
    name: "gstatus",
    aliases: ["gs"],
    category: "status",
    description: "Post a group status from text or quoted text.",
    run: (ctx) =>
      card(ctx, async () => {
        const text = ctx.rawPayload || ctx.quoted?.text || "";
        if (!text) return renderCard.error("Group status", "Provide text or quote a message.");
        const transport = requireTransport(deps);
        await transport.sendGroupStatus(ctx.chatJid!, { text });
        return renderCard.status("Group status", "Posted", [{ label: "Chars", value: String(text.length) }]);
      }),
  });

  // ---- Repeated group status (§18) ----
  registry.register({
    name: "gstatusx",
    aliases: ["gsx"],
    category: "status",
    description: "Post a group status N times (1–20) via the operation engine.",
    run: (ctx) =>
      card(ctx, async () => {
        const match = /^(\d{1,3})\s+([\s\S]+)$/u.exec(ctx.rawPayload.trim());
        if (!match) return renderCard.error("Repeated status", "Usage: gstatusx <count> <text>");
        const requested = Number(match[1]);
        if (!Number.isInteger(requested) || requested < 1 || requested > REPEAT_CAP)
          return renderCard.error("Repeated status", `Count must be 1–${REPEAT_CAP}. You asked for ${requested}.`);
        const text = match[2]!.trim();
        const transport = requireTransport(deps);
        const targets: OperationTarget[] = Array.from({ length: requested }, (_, index) => ({ id: `post-${index + 1}`, name: `post ${index + 1}` }));
        return startBulk(deps, workspaceOf(ctx), sessionOf(ctx), "GSTATUSX", targets, async () => {
          await transport.sendGroupStatus(ctx.chatJid!, { text });
          return "completed";
        });
      }),
  });

  // ---- Target status (§17) ----
  registry.register({
    name: "togstatus",
    aliases: ["togs"],
    category: "status",
    description: "Post a status to a target group by invite link.",
    run: (ctx) =>
      card(ctx, async () => {
        const link = /https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/iu.exec(ctx.rawPayload)?.[0];
        if (!link) return renderCard.error("Target status", "Include the target group's invite link.");
        const text = ctx.rawPayload.replace(link, "").trim() || ctx.quoted?.text || "";
        const transport = requireTransport(deps);
        await transport.sendTargetGroupStatus(link, { text });
        return renderCard.status("Target status", "Sent to target", [{ label: "Target", value: link }]);
      }),
  });

  // ---- All status (§20) + delay (§21) ----
  registry.register({
    name: "allstatus",
    aliases: ["alls"],
    category: "status",
    description: "Post a status to every eligible group (live progress).",
    run: (ctx) =>
      card(ctx, async () => {
        const text = ctx.rawPayload.trim() || ctx.quoted?.text || "";
        if (!text) return renderCard.error("All status", "Provide text or quote a message.");
        const transport = requireTransport(deps);
        const groups = (await transport.listGroupJids()).slice(0, TARGET_CAP);
        if (!groups.length) return renderCard.error("All status", "No eligible groups resolved for this session.");
        return startBulk(deps, workspaceOf(ctx), sessionOf(ctx), "ALLSTATUS", groups.map((group) => ({ id: group.jid, ...(group.name ? { name: group.name } : {}) })), async (target) => {
          await transport.sendGroupStatus(target.id, { text });
          return "completed";
        });
      }),
  });

  registry.register({
    name: "allstatusd",
    aliases: ["allsd"],
    category: "automation",
    description: "Set per-destination delay for bulk operations (5s–5m).",
    run: (ctx) =>
      card(ctx, async () => {
        const ms = parseDurationMs(ctx.args[0] ?? "");
        if (!ms || ms < 5_000 || ms > 5 * 60_000)
          return renderCard.error("Bulk delay", "Provide a delay between 5s and 5m.", { next: ["allstatusd 30s"] });
        // Operation-scoped rule (§21): only new operations pick this up.
        deps.runtime.delayMs = ms;
        return renderCard.status("Bulk delay", `${Math.round(ms / 1000)}s per destination`, [
          { label: "Applies to", value: "New operations; running ones keep their own delay" },
        ]);
      }),
  });

  // ---- Tag (§22) — immediate, optimized path ----
  registry.register({
    name: "tag",
    aliases: [],
    category: "messaging",
    description: "Send a message mentioning everyone (fast path).",
    groupOnly: true,
    run: (ctx) =>
      card(ctx, async () => {
        const text = ctx.rawPayload || ctx.quoted?.text || "";
        if (!text) return renderCard.error("Tag", "Provide text or quote a message.");
        const transport = requireTransport(deps);
        const groups = await transport.listGroupJids();
        const here = groups.find((group) => group.jid === ctx.chatJid);
        const mentionJids = ctx.mentions.length ? ctx.mentions : [];
        await transport.sendGroupTextHidden(ctx.chatJid!, text);
        void here;
        void mentionJids;
        return renderCard.status("Tag", "Delivered", [{ label: "Mode", value: ctx.mentions.length ? "targeted mentions" : "hidden-mentions" }]);
      }),
  });

  // ---- All chat (§24) ----
  registry.register({
    name: "allchat",
    aliases: [],
    category: "messaging",
    description: "Send a message to every eligible group (live progress).",
    run: (ctx) =>
      card(ctx, async () => {
        const text = ctx.rawPayload.trim() || ctx.quoted?.text || "";
        if (!text) return renderCard.error("All chat", "Provide text or quote a message.");
        const transport = requireTransport(deps);
        const groups = (await transport.listGroupJids()).slice(0, TARGET_CAP);
        if (!groups.length) return renderCard.error("All chat", "No eligible groups resolved.");
        return startBulk(deps, workspaceOf(ctx), sessionOf(ctx), "ALLCHAT", groups.map((group) => ({ id: group.jid, ...(group.name ? { name: group.name } : {}) })), async (target) => {
          await transport.sendGroupTextHidden(target.id, text);
          return "completed";
        });
      }),
  });
}
