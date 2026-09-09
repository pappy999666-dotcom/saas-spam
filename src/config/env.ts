/**
 * Environment configuration. Fail fast on invalid input (spec §56):
 * secrets come from env only, are never logged, and production requires
 * the minimum secret set.
 */

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  OWNER_TELEGRAM_IDS: z.string().default(""),
  ENCRYPTION_SECRET: z.string().min(32).optional(),
  SESSION_ROOT: z.string().default("./storage/sessions"),
  MEDIA_ROOT: z.string().default("./data/media"),
  /** Per-session command prefix default; sessions may override (spec §6). */
  DEFAULT_WA_PREFIX: z.string().max(3).default("."),
  /** Custom pairing code must be exactly 8 chars (plogme constraint, verified). */
  PAIRING_CUSTOM_CODE: z
    .string()
    .regex(/^[A-Z0-9]{8}$/iu, "Pairing code must be exactly 8 letters/digits")
    .default("SAASSPAM"),
});

export const env = envSchema.parse(process.env);

export const ownerTelegramIds = new Set(
  env.OWNER_TELEGRAM_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export function assertProductionSecrets(): void {
  if (env.NODE_ENV === "production" && !env.TELEGRAM_BOT_TOKEN)
    throw new Error("TELEGRAM_BOT_TOKEN is required in production.");
  if (env.NODE_ENV === "production" && !env.ENCRYPTION_SECRET)
    throw new Error("ENCRYPTION_SECRET (32+ chars) is required in production.");
}
