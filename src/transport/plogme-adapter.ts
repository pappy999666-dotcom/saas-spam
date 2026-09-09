/**
 * plogme transport adapter (Phase 2).
 *
 * Owns socket lifecycle and exposes verified engine capabilities as typed,
 * classified operations. Uses ONLY APIs verified in docs/REFERENCE_AUDIT.md:
 * pairing (QR + 8-char custom code), groups, participants, settings, invites,
 * pictures, status (personal + group), and messaging. Anything unverified is
 * marked and stays unexposed.
 */

import makeWASocket, { makeCacheManagerAuthState, type CacheManagerStore, type WASocket } from "plogme";
import { ClassifiedError, classifyError } from "../core/errors.js";
import { phoneJidFromIdentity } from "../core/identity.js";
import { callWithTimeout, socketMethod, type PlogmeSocketLike } from "./capabilities.js";
import { logger } from "../core/logger.js";

const QUERY_TIMEOUT_MS = 15_000;

/** File/memory-backed auth state store contract (implement per deployment). */
export interface AuthStateStore extends CacheManagerStore {}

export interface AdapterEvents {
  /** Fired as soon as the pairing code exists (user should see it immediately). */
  onPairingCode?: (code: string, phoneNumber: string) => void;
  /** Fired on every connection.update (state machine source). */
  onConnectionUpdate?: (state: { connection?: string; phoneNumber?: string }) => void;
}

export interface SocketHandle {
  socket: WASocket;
  stop: () => void;
}

export interface StartSocketOptions {
  phoneNumber: string;
  authStore: CacheManagerStore;
  /** Exactly 8 letters/digits; undefined → engine generates a code. */
  customPairingCode?: string;
  events?: AdapterEvents;
  /** Version override (keep pinned in production). */
  version?: [number, number, number];
  /** Resolve as soon as the pairing code is issued instead of waiting for open. */
  waitForOpen?: boolean;
}

const silentLogger = () => undefined;
const engineLogger = Object.assign(
  () => undefined,
  {
    level: "silent",
    child: () => engineLogger,
    info: silentLogger,
    error: silentLogger,
    warn: silentLogger,
    debug: silentLogger,
    trace: silentLogger,
    fatal: silentLogger,
  },
);

interface ConnectionUpdate {
  connection?: string;
  pairingCode?: string;
  qr?: string;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  me?: { id?: string; name?: string };
}

/**
 * Start a WhatsApp socket. With waitForOpen=false (default) it resolves right
 * after the pairing code is issued so the control plane can show it instantly;
 * connection outcomes continue through events.
 */
export async function startSocket(options: StartSocketOptions): Promise<SocketHandle> {
  if (options.customPairingCode !== undefined && !/^[A-Z0-9]{8}$/iu.test(options.customPairingCode))
    throw new ClassifiedError("invalid_target", "Custom pairing code must be exactly 8 letters or digits.");

  const authState = await makeCacheManagerAuthState(options.authStore);
  const socket = makeWASocket({
    version: options.version ?? [2, 3000, 1015905247],
    auth: authState.state,
    logger: engineLogger,
    markOnlineOnConnect: false,
    browser: ["SaaS Promoter", "Chrome", "1.0.0"],
    fireInitQueries: false,
    syncFullHistory: false,
  } as Parameters<typeof makeWASocket>[0]);

  const events = socket.ev as { on: (event: string, listener: (payload: unknown) => void) => void } | undefined;

  const outcome = new Promise<"open" | "closed">((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new ClassifiedError("timeout", "Timed out waiting for the socket to open.")),
      90_000,
    );
    events?.on("connection.update", (raw: unknown) => {
      const update = (raw ?? {}) as ConnectionUpdate;
      if (update.pairingCode) options.events?.onPairingCode?.(update.pairingCode, options.phoneNumber);
      options.events?.onConnectionUpdate?.({
        ...(update.connection ? { connection: update.connection } : {}),
        phoneNumber: options.phoneNumber,
      });
      if (update.connection === "open") {
        clearTimeout(timeout);
        resolve("open");
      }
      if (update.connection === "close") {
        clearTimeout(timeout);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (options.waitForOpen) {
          reject(classifyError(new Error(`socket closed (${code ?? "unknown"})`)));
        } else {
          resolve("closed");
        }
      }
    });
  });

  // Pairing code request: verified API `requestPairingCode(phone, customPairingCode?)`
  // — custom codes MUST be exactly 8 chars (engine-enforced; see REFERENCE_AUDIT.md).
  const requestPairing = socketMethod<string>(socket as PlogmeSocketLike, "requestPairingCode");
  const pairingCode = await requestPairing(options.phoneNumber, options.customPairingCode);
  options.events?.onPairingCode?.(pairingCode, options.phoneNumber);

  if (options.waitForOpen === true) {
    const result = await outcome;
    if (result === "open") logger.info("WhatsApp socket opened", { phoneNumber: options.phoneNumber });
  }

  return {
    socket,
    stop: () => {
      try {
        socketMethod(socket as PlogmeSocketLike, "end")(new ClassifiedError("cancelled", "Socket stopped by request."));
      } catch {
        // already closed
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Verified operations (typed, classified). All go through the capability gate.
// ---------------------------------------------------------------------------

export interface GroupParticipant {
  id: string;
  phoneNumber?: string;
  admin?: string | null;
}

export interface GroupMetadataResult {
  jid: string;
  subject: string;
  description?: string;
  participantCount: number;
  participants: GroupParticipant[];
}

function normalizeGroupMetadata(raw: Record<string, unknown>, jid: string): GroupMetadataResult {
  const participants = Array.isArray(raw.participants) ? (raw.participants as Array<Record<string, unknown>>) : [];
  return {
    jid,
    subject: typeof raw.subject === "string" ? raw.subject : jid,
    ...(typeof raw.desc === "string" ? { description: raw.desc } : {}),
    participantCount: participants.length,
    participants: participants.map((participant) => ({
      id: String(participant.id ?? ""),
      ...(typeof participant.phoneNumber === "string" ? { phoneNumber: participant.phoneNumber } : {}),
      ...(participant.admin ? { admin: String(participant.admin) } : {}),
    })),
  };
}

export async function groupCreate(socket: WASocket, subject: string, phoneNumbers: string[]): Promise<{ jid: string }> {
  const create = socketMethod<{ id: string }>(socket as PlogmeSocketLike, "groupCreate");
  const invited = phoneNumbers.map((digits) => phoneJidFromIdentity(digits)).filter((value): value is string => Boolean(value));
  const result = await callWithTimeout(() => create(subject, invited), QUERY_TIMEOUT_MS, "groupCreate");
  return { jid: String((result as { id?: string } | undefined)?.id ?? "") };
}

export async function groupMetadata(socket: WASocket, jid: string): Promise<GroupMetadataResult> {
  const query = socketMethod<Record<string, unknown>>(socket as PlogmeSocketLike, "groupMetadata");
  const raw = await callWithTimeout(() => query(jid), QUERY_TIMEOUT_MS, "groupMetadata");
  return normalizeGroupMetadata(raw ?? {}, jid);
}

export type ParticipantAction = "promote" | "demote" | "add" | "remove";

export async function groupParticipantsUpdate(socket: WASocket, jid: string, participants: string[], action: ParticipantAction): Promise<Array<{ jid: string; error?: string }>> {
  const update = socketMethod<Array<Record<string, unknown>>>(socket as PlogmeSocketLike, "groupParticipantsUpdate");
  const result = await callWithTimeout(() => update(jid, participants, action), QUERY_TIMEOUT_MS, "groupParticipantsUpdate");
  return (result ?? []).map((entry) => ({
    jid: String(entry.jid ?? ""),
    ...(entry.error !== undefined && entry.error !== null ? { error: String(entry.error) } : {}),
  }));
}

export async function groupSettingUpdate(socket: WASocket, jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked"): Promise<void> {
  const update = socketMethod(socket as PlogmeSocketLike, "groupSettingUpdate");
  await callWithTimeout(() => update(jid, setting), QUERY_TIMEOUT_MS, "groupSettingUpdate");
}

export async function groupInviteCode(socket: WASocket, jid: string): Promise<string> {
  const code = socketMethod<string>(socket as PlogmeSocketLike, "groupInviteCode");
  return callWithTimeout(async () => String(await code(jid)), QUERY_TIMEOUT_MS, "groupInviteCode");
}

export async function groupLeave(socket: WASocket, jid: string): Promise<void> {
  const leave = socketMethod(socket as PlogmeSocketLike, "groupLeave");
  await callWithTimeout(() => leave(jid), QUERY_TIMEOUT_MS, "groupLeave");
}

export async function updateProfilePicture(socket: WASocket, jid: "self" | string, image: Buffer): Promise<void> {
  const update = socketMethod(socket as PlogmeSocketLike, "updateProfilePicture");
  await callWithTimeout(() => update(jid, image), 30_000, "updateProfilePicture");
}

export async function removeProfilePicture(socket: WASocket, jid: "self" | string): Promise<void> {
  const remove = socketMethod(socket as PlogmeSocketLike, "removeProfilePicture");
  await callWithTimeout(() => remove(jid), QUERY_TIMEOUT_MS, "removeProfilePicture");
}

export async function profilePictureUrl(socket: WASocket, jid: string, type: "image" | "preview" = "image"): Promise<string | undefined> {
  const url = socketMethod<string | undefined>(socket as PlogmeSocketLike, "profilePictureUrl");
  try {
    return (await callWithTimeout(() => url(jid, type), QUERY_TIMEOUT_MS, "profilePictureUrl")) ?? undefined;
  } catch (error) {
    // "not-authorized"/404 style responses mean "no picture set" — not an error for UX.
    const classified = classifyError(error);
    if (classified.kind === "invalid_target" || classified.kind === "permission") return undefined;
    throw classified;
  }
}

export interface GroupStatusPayload {
  text?: string;
  image?: { url?: string; media?: Buffer; mimetype?: string; caption?: string };
  video?: { url?: string; media?: Buffer; mimetype?: string; caption?: string };
}

/**
 * Post a group status (verified shape: sendMessage with `groupStatus: true`).
 */
export async function sendGroupStatus(socket: WASocket, jid: string, payload: GroupStatusPayload): Promise<void> {
  const send = socketMethod(socket as PlogmeSocketLike, "sendMessage");
  await callWithTimeout(() => send(jid, { ...payload, groupStatus: true }), 30_000, "sendGroupStatus");
}

export interface PersonalStatusPayload extends GroupStatusPayload {
  backgroundColor?: string | number;
  font?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Post a personal status with explicit viewers (verified: sendStatus requires statusJidList). */
export async function sendPersonalStatus(socket: WASocket, payload: PersonalStatusPayload, statusJidList: string[]): Promise<void> {
  if (!statusJidList.length) throw new ClassifiedError("invalid_target", "Personal status requires at least one viewer JID.");
  const send = socketMethod(socket as PlogmeSocketLike, "sendStatus");
  await callWithTimeout(() => send({ ...payload }, { statusJidList }), 30_000, "sendStatus");
}

export interface SendTextOptions {
  mentions?: string[];
  /** Link preview supplied by the Preview Engine; engine-side generation stays off. */
  linkPreview?: {
    canonicalUrl: string;
    matchedText?: string;
    title?: string;
    description?: string;
    thumbnail?: Buffer;
  };
}

export async function sendText(socket: WASocket, jid: string, text: string, options?: SendTextOptions): Promise<void> {
  const send = socketMethod(socket as PlogmeSocketLike, "sendMessage");
  const content: Record<string, unknown> = { text };
  if (options?.mentions?.length) content.mentions = options.mentions;
  if (options?.linkPreview) content.linkPreview = options.linkPreview;
  await callWithTimeout(() => send(jid, content), 30_000, "sendText");
}

export async function sendMedia(socket: WASocket, jid: string, kind: "image" | "video" | "audio" | "sticker" | "document", media: Buffer, options?: { caption?: string; mimeType?: string; fileName?: string; mentions?: string[]; ptt?: boolean }): Promise<void> {
  const send = socketMethod(socket as PlogmeSocketLike, "sendMessage");
  const content: Record<string, unknown> = { [kind]: media };
  if (options?.caption && kind !== "sticker" && kind !== "audio") content.caption = options.caption;
  if (options?.mimeType) content.mimetype = options.mimeType;
  if (options?.fileName && (kind === "document" || kind === "video")) content.fileName = options.fileName;
  if (options?.mentions?.length) content.mentions = options.mentions;
  if (options?.ptt !== undefined && kind === "audio") content.ptt = options.ptt;
  await callWithTimeout(() => send(jid, content), 60_000, "sendMedia");
}

export async function groupFetchAllParticipating(socket: WASocket): Promise<Record<string, Record<string, unknown>>> {
  const fetch = socketMethod<Record<string, Record<string, unknown>>>(socket as PlogmeSocketLike, "groupFetchAllParticipating");
  return (await callWithTimeout(() => fetch(), QUERY_TIMEOUT_MS, "groupFetchAllParticipating")) ?? {};
}
