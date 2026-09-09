/**
 * Command model + parser (spec §6, §7, §8, §23).
 *
 * Pipeline: normalizer → parser → prefix resolver → session resolver →
 * permission resolver → context resolver → handler. The parser is fully
 * deterministic — no AI in the hot path (spec §48).
 *
 * Prefix model is per-session (spec §6):
 *   { prefix: string, prefixMode: "required" | "optional" | "none" }
 * The Telegram bridge may carry its own independent prefix config (spec §7).
 *
 * Self-chaining tags (spec §23): "tag tag hi" → nested command args are
 * unwrapped with a bounded depth (MAX_CHAIN_DEPTH); recursion beyond the
 * cap is rejected, never looped.
 */

export type PrefixMode = "required" | "optional" | "none";

export interface PrefixConfig {
  /** Empty string means prefixless. */
  prefix: string;
  prefixMode: PrefixMode;
}

export const DEFAULT_PREFIX_CONFIG: PrefixConfig = { prefix: ".", prefixMode: "required" };

/** Hard cap on nested self-chaining commands (spec §23). */
export const MAX_CHAIN_DEPTH = 3;

export const COMMAND_SYNTAX_ERROR = "COMMAND_SYNTAX_ERROR" as const;

export interface ParsedCommand {
  /** Lowercased command name (outermost, after chain unwrapping). */
  name: string;
  /** Remaining arguments with nested command prefixes stripped. */
  args: string[];
  /** Raw unparsed payload (everything after the command name, before unwrapping). */
  rawPayload: string;
  /** How the command was addressed. */
  prefixUsed: string | null;
  /** Number of self-chain levels that were unwrapped. */
  chainDepth: number;
}

export interface ParseInput {
  text: string;
  prefixConfig: PrefixConfig;
  /** Known command + alias names (lowercase). Used to recognize chain nesting. */
  knownNames: ReadonlySet<string>;
  /** Telegram bridge configs are independent of the WhatsApp prefix (spec §7). */
  allowBareCommands?: boolean;
}

/**
 * Decide whether `text` is addressed as a command under the given prefix
 * config. In `none` mode only known command names are accepted, so ordinary
 * conversation is never intercepted (spec §33).
 */
export function isAddressedAsCommand(text: string, prefixConfig: PrefixConfig): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (prefixConfig.prefix && trimmed.toLowerCase().startsWith(prefixConfig.prefix.toLowerCase()))
    return true;
  return prefixConfig.prefixMode !== "required";
}

export function parseCommand(input: ParseInput): ParsedCommand | null {
  const trimmed = input.text.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  let body = trimmed;
  let prefixUsed: string | null = null;

  const hasConfiguredPrefix =
    input.prefixConfig.prefix !== "" &&
    lower.startsWith(input.prefixConfig.prefix.toLowerCase());
  const hasDefaultDot = !hasConfiguredPrefix && lower.startsWith(".");
  const bareAllowed =
    input.allowBareCommands === true ||
    input.prefixConfig.prefixMode === "optional" ||
    input.prefixConfig.prefixMode === "none";

  if (hasConfiguredPrefix) {
    prefixUsed = trimmed.slice(0, input.prefixConfig.prefix.length);
    body = trimmed.slice(input.prefixConfig.prefix.length).trim();
  } else if (hasDefaultDot && bareAllowed) {
    // Bridge convenience: a leading dot is accepted even when the session
    // prefix differs, so Telegram controls keep working when prefixes change
    // (spec §7). In required WhatsApp mode without a matching prefix, only the
    // configured prefix counts.
    if (input.prefixConfig.prefixMode === "required" && input.allowBareCommands !== true) {
      return null;
    }
    prefixUsed = ".";
    body = trimmed.slice(1).trim();
  } else if (!bareAllowed) {
    return null;
  }

  const firstToken = body.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!firstToken) return null;
  if (prefixUsed === null && !input.knownNames.has(firstToken)) return null;

  // Unwrap bounded self-chains: "tag tag hi" → name "tag", args ["hi"].
  let name = firstToken;
  let rest = body.slice(body.indexOf(firstToken) + firstToken.length).trim();
  let chainDepth = 0;
  while (
    chainDepth < MAX_CHAIN_DEPTH &&
    input.knownNames.has(rest.split(/\s+/, 1)[0]?.toLowerCase() ?? "") &&
    input.knownNames.has(name)
  ) {
    const inner = rest.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    name = inner;
    rest = rest.slice(rest.indexOf(inner) + inner.length).trim();
    chainDepth += 1;
  }

  return {
    name,
    args: rest ? rest.split(/\s+/u) : [],
    rawPayload: rest,
    prefixUsed,
    chainDepth,
  };
}

/** Expand aliases to canonical names; unknown names pass through. */
export function canonicalCommandName(name: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(name.toLowerCase()) ?? name.toLowerCase();
}
