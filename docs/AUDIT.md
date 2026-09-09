# AUDIT.md — Phase 0 audit conclusions (gates for implementation)

Audit date: 2026-09-09. Full evidence in REFERENCE_AUDIT.md; target design in ARCHITECTURE.md.

## What was audited

1. **Reference repository** `pappy-panel-smoke` (pappy-omega-mini): ~221 files, 47 test files,
   **417 passing tests**, clean strict `tsc --noEmit`. Mature multi-tenant Telegram+WhatsApp SaaS.
   Audited: architecture, session manager, command registry (~100 commands), queues/scheduler,
   link preview engine, validator hub, join manager, auto promote, workload/panel mode, anti-system,
   Telegram control plane, identity/LID handling, admission control.
2. **plogme 1.0.3** (installed locally in the reference repo): typings, runtime method enumeration
   via `makeWASocket` instantiation, socket source (pairing, picture, group methods). See REFERENCE_AUDIT.md.
3. **Telegram Bot API**: current changelog fetched live — **Bot API 10.3 (Aug 24, 2026)** confirmed
   with Rich Messages, ephemeral messages, draft streaming, communities, Mini App origin hardening.
   The spec's claims are accurate and current.
4. **Reference GitHub repo** `pappy999666-dotcom/pappy-omega-mini` → HTTP 404 (private/renamed).
   The local `pappy-panel-smoke` tree is the authoritative reference implementation.

## Key conclusions

- The reference proves the product is viable and provides proven patterns to reimplement
  (identity normalization, admission control, capability-gated transport calls, preview caching,
  join scheduling). It also carries legacy branding, monolithic files (11k-line bot.ts, 2.5k-line
  command-registry), and subsystems the spec excludes (music/play, games, demo surfaces).
- **New-code decision confirmed**: build SaaS Promoter as a standalone repo; port concepts, not code.
- plogme capability highlights (verified, see REFERENCE_AUDIT.md for the full map):
  - Custom pairing code IS supported (`requestPairingCode(phone, customPairingCode)`, exactly 8 chars).
    The requested code `saas-spam` is 9 chars → invalid; decision recorded in DECISIONS.md (D2).
  - Group status: `sendMessage(jid, {...content, groupStatus: true})` + `deleteGroupStatus` — real.
  - Personal status: `sendStatus`, `sendStatusMention(s)`, fonts/colors — real.
  - Pictures: `updateProfilePicture`, `removeProfilePicture`, `profilePictureUrl(jid, type)`,
    `getGroupProfilePictures`, `setProfilePictureMex` — real.
  - Groups: `groupCreate`, `groupMetadata`, `groupParticipantsUpdate`, `groupSettingUpdate`,
    `groupUpdateSubject/Description`, `groupInviteCode`, `groupRevokeInvite`, `groupAcceptInvite`,
    `groupJoinApprovalMode`, `groupRequestParticipantsList/Update`, `groupLeave` — real.
  - Rich interactions: richMenu, sendInteractiveTable, sendRichButtonGrid, sendWhatsAppFlow — real.
  - Newsletters/channels: full family — real.
- Telegram client gap: the reference uses telegraf 4.x, which predates Bot API 10.x Rich Messages.
  SaaS Promoter plans a thin typed client on top of Bot API 10.3 (decision D3).

## Risks accepted / mitigations

| Risk | Mitigation |
|---|---|
| plogme typings are loose (`[key: string]: unknown`) | All socket access goes through one capability-gated adapter (Phase 2), mirroring the reference's proven `method()` pattern |
| WhatsApp ToS / anti-abuse exposure | Rate-aware schedulers, classified retries, no bypass mechanics (spec §15) |
| Spec references commands that imply LID exposure | Identity layer enforces verified-phone resolution; LID-only targets rejected (tested) |
