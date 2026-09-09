/**
 * Session settings (spec §6, §33, §35).
 *
 * Every WhatsApp session owns its own command configuration. Global settings
 * never silently masquerade as session settings — the two schemas are distinct
 * types and stored separately.
 */

import { z } from "zod";
import { DEFAULT_PREFIX_CONFIG, type PrefixConfig } from "../core/command-parser.js";

export const prefixConfigSchema = z.object({
  /** Empty string means prefixless. */
  prefix: z.string().max(3),
  prefixMode: z.enum(["required", "optional", "none"]),
});

export type SessionSettings = z.infer<typeof prefixConfigSchema> & {
  /** Telegram bridge prefix config — independent of the WhatsApp prefix (§7). */
  bridgePrefix: z.infer<typeof prefixConfigSchema>;
  /** Auto-collect links into the workspace validator buckets. */
  autoCollectLinks: boolean;
};

export const defaultSessionSettings = (): SessionSettings => ({
  prefix: DEFAULT_PREFIX_CONFIG.prefix,
  prefixMode: DEFAULT_PREFIX_CONFIG.prefixMode,
  bridgePrefix: { prefix: "", prefixMode: "optional" },
  autoCollectLinks: false,
});

export interface WorkspaceSettings {
  /** Telegram users allowed to control every session in the workspace. */
  globalSudoTelegramIds: string[];
  /** Operation defaults: per-destination delay for bulk operations (§21). */
  defaultBulkDelayMs: number;
  /** Emergency stop: when true, new bulk operations are refused. */
  emergencyStop: boolean;
}

export const defaultWorkspaceSettings = (): WorkspaceSettings => ({
  globalSudoTelegramIds: [],
  defaultBulkDelayMs: 10_000,
  emergencyStop: false,
});
