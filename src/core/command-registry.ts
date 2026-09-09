/**
 * Command registry (spec §8, §9).
 *
 * Commands are declared once with metadata; parsers, menus, and permission
 * checks all read from this single source. Handlers receive a normalized
 * CommandContext — they never re-parse transport payloads (spec §8).
 */

import type { PrefixConfig } from "./command-parser.js";
import type { Role } from "./permissions.js";

export type Platform = "whatsapp" | "telegram";

export type CommandCategory =
  | "groups"
  | "members"
  | "status"
  | "messaging"
  | "automation"
  | "media"
  | "sessions"
  | "utilities";

export interface QuotedContext {
  senderJid?: string;
  text?: string;
  messageType?: string;
  /** Media bytes are resolved lazily by the media resolver, not eagerly. */
  hasMedia: boolean;
}

export interface MediaContext {
  kind: "image" | "video" | "audio" | "voice" | "sticker" | "document" | "location" | "contact";
  mimeType?: string;
  fileName?: string;
  caption?: string;
}

export interface CommandContext {
  platform: Platform;
  workspaceId: string;
  sessionId: string;
  chatJid?: string;
  senderJid?: string;
  senderRole: Role;
  command: string;
  args: string[];
  rawPayload: string;
  prefixConfig: PrefixConfig;
  mentions: string[];
  quoted?: QuotedContext;
  media?: MediaContext;
  /** Populated by the operation engine for long-running work. */
  operationId?: string;
  receivedAt?: number;
  /** Transport send capability — injected so handlers stay transport-pure. */
  reply: (payload: ReplyPayload) => Promise<void>;
}

export interface ReplyPayload {
  text?: string;
  mentions?: string[];
  media?: MediaContext & { bytes: Buffer };
  /** Native interactive buttons where the platform supports them. */
  buttons?: Array<{ id: string; text: string; style?: "confirm" | "cancel" | "neutral" }>;
  /** Suggested next commands (rendered per platform). */
  followUps?: string[];
  /** Operation view id for live progress rendering. */
  operationViewId?: string;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  usage?: string;
  ownerOnly?: boolean;
  /** Only valid inside a WhatsApp group chat. */
  groupOnly?: boolean;
  run: (ctx: CommandContext) => Promise<ReplyPayload | string>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly aliasToCanonical = new Map<string, string>();

  register(definition: CommandDefinition): void {
    const name = definition.name.toLowerCase();
    if (this.commands.has(name)) throw new Error(`Duplicate command: ${name}`);
    this.commands.set(name, definition);
    this.aliasToCanonical.set(name, name);
    for (const alias of definition.aliases ?? []) {
      const key = alias.toLowerCase();
      if (this.aliasToCanonical.has(key))
        throw new Error(`Duplicate alias: ${key} (claimed by ${this.aliasToCanonical.get(key)})`);
      this.aliasToCanonical.set(key, name);
    }
  }

  resolve(name: string): CommandDefinition | undefined {
    const canonical = this.aliasToCanonical.get(name.toLowerCase());
    return canonical ? this.commands.get(canonical) : undefined;
  }

  get aliasMap(): ReadonlyMap<string, string> {
    return this.aliasToCanonical;
  }

  /** Known names + aliases for the parser's chain/known-name checks. */
  get knownNames(): ReadonlySet<string> {
    return new Set(this.aliasToCanonical.keys());
  }

  list(category?: CommandCategory): CommandDefinition[] {
    return [...this.commands.values()]
      .filter((command) => (category ? command.category === category : true))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
