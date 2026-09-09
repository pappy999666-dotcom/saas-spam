# REFERENCE_AUDIT.md — plogme + pappy-omega-mini + Telegram Bot API

All findings verified against installed sources / live runtime / official docs. No invented APIs.
Anything not verified is explicitly marked UNVERIFIED.

## 1. plogme 1.0.3 (WhatsApp transport)

Identity: Baileys fork ("Production-ready Baileys fork ... rich responses, interactive messages,
albums, newsletters, communities — without antiban wrappers"). ESM, Node >= 20.
Note: a different package `@crysnovax/baileys` 0.0.1 was flagged malware and removed from npm —
plogme is the maintained successor line; we pin the exact installed version.

### 1.1 Verified capability matrix (runtime-enumerated from a live socket instance)

| Capability | plogme API | Status |
|---|---|---|
| Pairing code | `requestPairingCode(phone, customPairingCode?)` | VERIFIED — custom code must be exactly 8 chars |
| QR pairing | `fetchQRCode`, connection events | VERIFIED (exists; flow parity UNVERIFIED live) |
| Send message | `sendMessage(jid, content, options)` | VERIFIED |
| Personal status | `sendStatus(content)`, `sendStatusMention(s)`, fonts 0-9, colors | VERIFIED |
| Group status | `sendMessage(jid, { ...content, groupStatus: true })`, `deleteGroupStatus` | VERIFIED |
| Status privacy lists | `getStatusPrivacy`, `setStatusPrivacy` (contacts/whitelist/blacklist/null + custom lists) | VERIFIED |
| Profile picture | `updateProfilePicture(jid, buf)`, `removeProfilePicture(jid)`, `profilePictureUrl(jid, type)`, `setProfilePictureMex`, `getGroupProfilePictures(jids, type)` | VERIFIED |
| Group create | `groupCreate(subject, participants)` | VERIFIED |
| Group metadata/participants | `groupMetadata`, `groupParticipantsUpdate` (promote/demote/add/remove), `groupQuery` | VERIFIED |
| Group settings | `groupSettingUpdate` (announcement/locked/etc.), `groupToggleEphemeral` | VERIFIED |
| Group invite ops | `groupInviteCode`, `groupRevokeInvite`, `groupAcceptInvite`, `groupGetInviteInfo`, join-approval `groupJoinApprovalMode`, `groupRequestParticipantsList/Update` | VERIFIED |
| Group identity | `groupUpdateSubject`, `groupUpdateDescription`, `groupLeave` | VERIFIED |
| Community/linked groups | `groupJoinLinked`, `groupGetLinkedParticipants`, sub-group suggestions | VERIFIED |
| Newsletters/channels | `newsletterCreate/Follow/Unfollow/Metadata/FetchMessages/SendMessage/React/...` | VERIFIED |
| Rich interactions | `richMenu`, `sendInteractiveTable`, `sendRichButtonGrid`, `sendRichWebview`, `sendWhatsAppFlow`, `sendRichGeneration/updateRichGeneration` | VERIFIED |
| Media | `waUploadToServer`, `downloadMediaMessage` (in lib/Utils/messages) | VERIFIED |
| Copy button / HTML | `sendCopyButton`, `sendHtmlMessage`, `sendCodeBlock` | VERIFIED |
| Privacy | `getPrivacySettings`, `setPrivacySetting`, `updateGroupsAddPrivacy`, `updateLastSeenPrivacy`, ... | VERIFIED |
| Block/report | `updateBlockStatus`, `reportContact`, `reportGroup` | VERIFIED |
| LID | `fetchQRCode(..., 'lid')`, LID mapping store (lib/Signal/lid-mapping.js) | VERIFIED |

UNVERIFIED / REQUIRES IMPLEMENTATION OR ALTERNATIVE:
- Exact behavior of `groupStatus` delivery to non-linked parent groups at scale (needs live session).
- Album/`botForwardedMessage` composite send semantics (referenced in code, not exercised).
- Whether WhatsApp accepts the exact custom code charset beyond alnum (keep to alnum).

### 1.2 Known quirks observed in the reference's patched fork
- LRU caches in libsignal/lid-mapping were unbounded with `ttlAutopurge` (one timer per entry);
  the reference ships a pnpm patch bounding them. If we hit the same growth, apply an equivalent
  patch here — do not assume 1.0.3 stock is safe at high group volume.
- Engine-level link preview generation duplicates app-side previews; the reference disables it via
  `BAILEYS_HIGH_QUALITY_LINK_PREVIEW=false` and builds its own. Plan the same for Phase 3.

## 2. pappy-omega-mini (reference blueprint) — reuse map

| Reference area | Verdict | Rationale / port plan |
|---|---|---|
| identity-normalization (LID policy) | KEEP (reimplement) | Proven semantics; ported as src/core/identity.ts with tests |
| Error classification ideas | KEEP (improve) | Formalized as ClassifiedError + FailureKind (src/core/errors.ts) |
| Inbound/outbound admission (bounded priority queues) | REPLACE (design first) | Spec §30 wants scoped listening leases; design admission + leases in Phase 2 |
| Capability-gated transport `method()` | KEEP (pattern) | Rebuild in Phase 2 adapter; never duck-type raw socket calls |
| Link Preview Engine (canonical fetch, sharp normalize, v9 cache, concurrency 8, failure TTL) | KEEP (design) | Port lifecycle to Phase 3 with cache versioning from day one |
| Join scheduler (rate-aware, retries, cooldowns, restriction thresholds) | KEEP (design) | Phase 5 on the new operation engine |
| Validator Hub / link buckets | KEEP (design) | Phase 8 migration; do not port unused deps |
| Auto Promote (configs, scheduler, runs/history) | KEEP (design) | Phase 8 |
| Anti System (19 modules) | REDESIGN | Valuable but spec-excluded from MVP; keep off the critical path |
| Digital OS / Digital Confirm HTML screens | REDESIGN (later) | Rich interactions possible via plogme; defer until core is stable |
| Music play/lyrics/a2v, games, slot machine | REMOVE | Not in spec; external API deps; demo surfaces |
| Telegram bot.ts (11k lines) | REPLACE | Split into feature modules around a callback-router core; telegraf 4.x → typed Bot API 10.3 client (D3) |
| Command registry (2.5k lines, inline handlers) | REPLACE | New typed registry (done) + per-family command modules |
| pappy branding, ASCII headers | REMOVE | SaaS Promoter response system (§50): compact, intentional |
| Hybrid workload panel mode | DEFER | Architect operation engine so workload metrics can attach later (§41); not an MVP phase |

## 3. Telegram Bot API 10.3 (control plane)

Verified from the live changelog (2026-08-24 entry):
- **Rich Messages**: InputRichMessage + blocks (paragraphs, tables, quotations, collages, details),
  RichMessageButton/RichTextButton, expandable block quotations, document blocks.
- **Ephemeral messages**: per-user visible messages, `ephemeral_message_parameters`,
  edit/delete ephemeral messages, `replace_callback_query_message` — excellent for per-operator
  control views in shared groups.
- **Draft streaming**: sendMessageDraft/sendRichMessageDraft with can_stop/keep_on_stop — natural
  fit for live operation progress narration.
- **Communities**: CommunityChatJoined, community field on ChatFullInfo.
- **Mini App security**: origin hardening enforced from 2026-07-20 — the Mini App must serve from
  one pinned origin (decision for Phase 7).
- **Reply markup**: DisabledButton, force_reply on inline keyboards.

Framework reality: telegraf ^4.16 (reference) predates 10.x. Plan: thin typed client over
`fetch` (Bot API is plain HTTPS) exposing only what we use — sendMessage, editMessageText,
answerCallbackQuery, inline keyboards, sendRichMessage, ephemeral variants — with a compat
fallback if Rich Messages are unavailable to the bot account. UNVERIFIED: whether all 10.3
methods are enabled for every bot account at runtime; feature-detect at startup and degrade.
