/**
 * Join command family (spec §15).
 *
 * Rate-aware joins through the shared operation engine. Single explicit joins
 * run immediately; bulk joins use the configured delay. Errors are classified
 * (already member / invalid link / expired / full / rate-limited / network) —
 * never raw stack traces. No bypass mechanics; delays are the safety valve.
 */

import { renderCard, type ResponseCard } from "../ui/renderer.js";
import { userMessage } from "../core/errors.js";
import { parseDurationMs } from "./parse-duration.js";
import type { CommandDefinition, CommandRegistry } from "../core/command-registry.js";

export interface JoinTargetResult {
  target: string;
  outcome: "joined" | "already_member" | "request_submitted" | "failed";
  reason?: string;
}

export interface JoinTransport {
  /** Attempt one invite join; implement against plogme in the runtime. */
  join: (inviteUrl: string) => Promise<JoinTargetResult>;
}

const INVITE_RE = /https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/iu;

export function extractInviteUrls(text: string): string[] {
  const matches = text.match(new RegExp(INVITE_RE.source, "giu")) ?? [];
  return [...new Set(matches)];
}

export function registerJoinCommands(
  registry: CommandRegistry,
  options: {
    joinTransport?: JoinTransport;
    getBulkDelayMs: () => number;
    setBulkDelayMs: (ms: number) => void;
    enqueueBulkJoin?: (urls: string[], delayMs: number) => Promise<ResponseCard>;
  },
): void {
  registry.register({
    name: "join",
    aliases: [],
    category: "groups",
    description: "Join one or more groups via invite links.",
    run: async (ctx) => {
      try {
        const urls = extractInviteUrls(ctx.rawPayload);
        if (!urls.length) return renderCard.error("Join", "Paste one or more WhatsApp invite links.", { next: ["join <link>"] });
        if (!options.joinTransport) return renderCard.error("Join", "The session transport is not ready.");

        // Single explicit link → immediate join (no scheduler wait, spec §15).
        if (urls.length === 1) {
          const result = await options.joinTransport.join(urls[0]!);
          const headline =
            result.outcome === "joined"
              ? "Joined — accepted by WhatsApp"
              : result.outcome === "already_member"
                ? "Already a member of this group"
                : result.outcome === "request_submitted"
                  ? "Request submitted — pending group approval"
                  : `Failed: ${result.reason ?? "unknown"}`;
          return renderCard.status("Join result", headline, [{ label: "Link", value: urls[0]! }]);
        }

        // Multiple links → bulk scheduler.
        if (options.enqueueBulkJoin) return await options.enqueueBulkJoin(urls, options.getBulkDelayMs());
        return renderCard.error("Join", "Bulk joins are unavailable in this runtime.");
      } catch (error) {
        return renderCard.error("Join", userMessage(error));
      }
    },
  });

  registry.register({
    name: "joind",
    aliases: [],
    category: "automation",
    description: "Configure the delay between bulk joins (5s–5m).",
    run: async (ctx) => {
      const raw = ctx.args[0] ?? "";
      const ms = parseDurationMs(raw);
      if (!ms || ms < 5_000 || ms > 5 * 60_000)
        return renderCard.error("Join delay", "Provide a delay between 5s and 5m.", { next: ["joind 30s", "joind 2m"] });
      options.setBulkDelayMs(ms);
      return renderCard.status("Join delay", `${Math.round(ms / 1000)}s between bulk joins`, [
        { label: "Applies to", value: "New bulk operations (running ones keep their delay)" },
      ]);
    },
  });
}

// Join definition used by the runtime to run bulk joins on the operation engine.
export const bulkJoinOperationDefinition: CommandDefinition = {
  name: "joinbulk",
  aliases: [],
  category: "groups",
  description: "Internal: bulk join operation (started via .join with multiple links).",
  ownerOnly: true,
  run: async () => renderCard.error("Bulk join", "Use .join with multiple links."),
};
