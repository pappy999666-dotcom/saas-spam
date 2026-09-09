/**
 * Message normalizer + payload resolver (spec §27, §28).
 *
 * Converts raw plogme message structures into the normalized shape consumed
 * by the dispatcher. Command handlers never touch raw Baileys payloads.
 */

import type { MediaContext, QuotedContext } from "../core/command-registry.js";

export type WrappedKey =
  | "ephemeralMessage"
  | "viewOnceMessage"
  | "viewOnceMessageV2"
  | "viewOnceMessageV3"
  | "documentWithCaptionMessage"
  | "groupStatusMessage"
  | "groupStatusMessageV2"
  | "groupStatusMentionMessage"
  | "statusMentionMessage"
  | "statusMentionReply"
  | "botForwardedMessage";

const WRAPPED_KEYS: readonly WrappedKey[] = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV3",
  "documentWithCaptionMessage",
  "groupStatusMessage",
  "groupStatusMessageV2",
  "groupStatusMentionMessage",
  "statusMentionMessage",
  "statusMentionReply",
  "botForwardedMessage",
];

export interface NormalizedMessage {
  chatJid: string;
  senderJid: string;
  messageId?: string;
  fromMe: boolean;
  text: string;
  mentions: string[];
  quoted?: QuotedContext;
  media?: MediaContext;
  isGroup: boolean;
  isGroupStatus: boolean;
  rawType: string;
}

type MessageContent = Record<string, unknown>;

/** Unwrap common envelope types up to a bounded depth (no unbounded recursion). */
export function unwrapMessage(content: MessageContent | undefined, depth = 0): MessageContent {
  if (!content || depth >= 8) return content ?? {};
  for (const key of WRAPPED_KEYS) {
    const candidate = content[key];
    if (candidate && typeof candidate === "object") {
      const inner = (candidate as MessageContent).message;
      if (inner && typeof inner === "object") return unwrapMessage(inner as MessageContent, depth + 1);
    }
  }
  return content;
}

const MEDIA_TYPE_MAP: Record<string, MediaContext["kind"]> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  stickerMessage: "sticker",
  documentMessage: "document",
};

export function detectMessageType(content: MessageContent): { type: string; media?: MediaContext } {
  const direct = ["conversation", "extendedTextMessage", "imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage", "locationMessage", "contactMessage", "pollCreationMessage"];
  for (const type of direct) {
    if (content[type] === undefined) continue;
    const mediaKind = MEDIA_TYPE_MAP[type];
    if (mediaKind) {
      const mediaPart = content[type] as Record<string, unknown>;
      const media: MediaContext = {
        kind: mediaKind,
        ...(typeof mediaPart.mimetype === "string" ? { mimeType: mediaPart.mimetype } : {}),
        ...(typeof mediaPart.fileName === "string" ? { fileName: mediaPart.fileName } : {}),
        ...(typeof mediaPart.caption === "string" ? { caption: mediaPart.caption } : {}),
      };
      return { type, media };
    }
    return { type };
  }
  return { type: "unknown" };
}

interface RawKey {
  remoteJid?: string;
  fromMe?: boolean;
  participant?: string;
  id?: string;
}

export function normalizeIncomingMessage(raw: { key?: RawKey; message?: MessageContent; pushName?: string }): NormalizedMessage {
  const key = raw.key ?? {};
  const chatJid = key.remoteJid ?? "";
  const isGroup = chatJid.endsWith("@g.us");
  const isGroupStatus = chatJid.endsWith("@g.us") && Boolean((raw.message ?? {}).groupStatusMessage || (raw.message ?? {}).groupStatusMessageV2);
  const content = unwrapMessage(raw.message);
  const { media } = detectMessageType(content);

  const extended = content.extendedTextMessage as Record<string, unknown> | undefined;
  const text =
    typeof content.conversation === "string"
      ? content.conversation
      : typeof extended?.text === "string"
        ? extended.text
        : typeof content.caption === "string"
          ? content.caption
          : "";

  const rawMentions = extended?.mentionedJid;
  const mentions = Array.isArray(rawMentions) ? rawMentions.map(String) : [];

  // Quoted context (§27): normalized once here.
  const contextInfo = (extended?.contextInfo ?? (content.imageMessage as Record<string, unknown> | undefined)?.contextInfo ?? {}) as Record<string, unknown>;
  const quotedParticipant = typeof contextInfo.participant === "string" ? contextInfo.participant : undefined;
  const quotedMessage = contextInfo.quotedMessage as MessageContent | undefined;
  const quotedType = quotedMessage ? detectMessageType(unwrapMessage(quotedMessage)).type : undefined;
  const quoted: QuotedContext | undefined = quotedParticipant
    ? {
        senderJid: quotedParticipant,
        hasMedia: Boolean(quotedMessage && detectMessageType(unwrapMessage(quotedMessage)).media),
        ...(quotedType ? { messageType: quotedType } : {}),
      }
    : undefined;

  const senderJid = key.fromMe ? key.participant ?? chatJid : key.participant ?? chatJid;

  return {
    chatJid,
    senderJid,
    ...(key.id ? { messageId: key.id } : {}),
    fromMe: key.fromMe === true,
    text,
    mentions,
    ...(quoted ? { quoted } : {}),
    ...(media ? { media } : {}),
    isGroup,
    isGroupStatus,
    rawType: detectMessageType(content).type,
  };
}
