# IMPLEMENTATION_PLAN.md — Phases & Execution Plan

> **Master Plan Reference**: See [`docs/MASTER_PLAN.md`](./MASTER_PLAN.md) for the complete architectural blueprint, designed status aesthetic engine (`_gstatusd`, `_allstatusd`), URL title extraction pipeline, and universal AI/engineer handoff protocol.

## Phase Checklist

- [x] **Phase 0 — Forensic Audit**: Completed repository, plogme runtime, reference project, and Telegram Bot API 10.3 audit. (See `AUDIT.md`, `REFERENCE_AUDIT.md`).
- [x] **Phase 1 — Core Foundation**: Error classification, identity normalization (zero LID leaks), role hierarchy, prefix parser with self-chain unwrapping, typed command registry, operation engine with progress/cancellation/retries. (Passed 51/51 tests).
- [ ] **Phase 2 — Designed Status & Aesthetic Engine**:
  - [ ] Saturated 20-color canvas palette + 12 ornamental Unicode frame templates.
  - [ ] Canonical URL title extraction & OpenGraph metadata normalization.
  - [ ] Status payload composer attaching verified rich link preview cards to status canvases.
  - [ ] Commands: `_gstatusd` / `_dgstatus`, `_allstatusd` / `_dallstatus`, `_togstatusd`.
- [ ] **Phase 3 — WhatsApp Transport & Session Management**:
  - [ ] Capability-gated `plogme` adapter (Node 20+ ESM, strictly no raw method calls).
  - [ ] Socket connection lifecycle, auto-reconnect with exponential backoff, and pairing with 8-character `SAASPROM` code.
  - [ ] Scoped listening lease state machine (`.listen 5m`) — zero passive group eavesdropping.
- [ ] **Phase 4 — Core WhatsApp Command Suite**:
  - [ ] Discovery: `_menu`, `_list`, `_help`, `_ping`, `_health`.
  - [ ] Groups: `_cgc` / `_creategc` (interactive flow), `_leavegc`, `_lvall` (with native [YES]/[NO] buttons), `_groups`.
  - [ ] Moderation: `_pmt`, `_dmt`, `_spmt`, `_sdmt` (smart promote/demote with verified phone numbers).
  - [ ] Join & Approvals: `_join`, `_joind`, `_pendingjoin`, `_approveall`, `_approveamt`, `_approvecountry`, `_rejectall`.
  - [ ] Tagging: `_tag`, `_stag` (latency-optimized, bounded depth recursion up to 3).
  - [ ] Bulk Broadcasts: `_allstatus`, `_allstatusx`, `_allchat`, `_allchatx`, `_allstatusd`, `_allchatd`.
  - [ ] Media Tools: `_setgpp`, `_setpfp`, `_rmpfp`, `_mp3`, `_cs`, `_stickerinfo`.
- [ ] **Phase 5 — Telegram Bot API 10.3 Control Plane**:
  - [ ] Thin, typed HTTPS client with feature-detection and graceful degradation.
  - [ ] Native bordered tables (`RichBlockTable`, `is_bordered = true`).
  - [ ] Native custom emoji formatting (`RichTextCustomEmoji`).
  - [ ] Draft progress streaming (`sendRichMessageDraft`) for Live Show feeds.
  - [ ] Ephemeral settings and modular callback router.
- [ ] **Phase 6 — Reference Feature Migration**:
  - [ ] Validator Hub with 5-stage bucket state machine (`Main` → `Validating` → `Active`/`Dead`/`Retryable`).
  - [ ] Join Manager with active-bucket consumption and cooldown cycles.
  - [ ] Auto-Promote multi-scope scheduler (`SESSION`, `USER`, `GLOBAL`).
- [ ] **Phase 7 — Workload Panel Subsystem**:
  - [ ] Single-file standalone `index.js` worker generator.
  - [ ] Pairing code handshake for external VPS/Pterodactyl panels.
  - [ ] Panel sharing and child-workspace access delegation.
- [ ] **Phase 8 — Hardening, Soak & Security Verification**:
  - [ ] SSRF defense verification on preview engine.
  - [ ] Socket restart soak tests under heavy group traffic.
  - [ ] 100% test pass on Vitest test suite.
