# CHANGELOG.md

## 0.2.0 — 2026-09-09

### Phase 1 completed
- Sessions: workspace/session registry with per-session settings, transport state, and
  **listening leases** (§30); hydration never restores "connected" without proof.
- UI: centralized response renderer (status/menu/operation/error cards, §49–§50) and the
  bounded interactive **flow framework** (§10): skip, cancel, timeout, invalid-input caps.

### Phase 2 — WhatsApp transport
- Capability-gated plogme adapter: pairing (QR + 8-char custom code), groups, participants,
  settings, invites, pictures, personal+group status, text/media sends — verified APIs only,
  every call classified + timeout-bounded.
- Message normalizer (envelope unwrapping, media/quoted context, §27–§28) and the dispatch
  pipeline: parser → permissions → lease gate → handler (§5, §8, §30).

### Phase 3 — Link Preview Engine
- DISCOVER → FETCH (SSRF-guarded, redirect-bounded) → NORMALIZE → THUMBNAIL (sharp, bounded
  JPEG) → VALIDATE → CACHE. Incomplete results are never cached; entries versioned; failure
  memory short; single-flight per URL; concurrency capped (§25–§26).

### Phase 4 — Core commands
- menu (+list), creategc (+cgc), glink, leavegc (+leave/lve/lvgc) with native confirm buttons,
  leaveall, pmt/dmt (+promote/demote aliases), spmt/sdmt with presence checks, listen (leases),
  setprefix (incl. prefixless mode), setgpp.

### Phase 5 — Status / Tag / Bulk
- gstatus/gs, gstatusx/gsx (count validated, never silently changed), togstatus/togs,
  allstatus/alls + allstatusd/allsd (operation-scoped delay, §21), tag, allchat — all on the
  shared operation engine with live progress cards and honest counters (§16–§24).

### Phase 6 — Telegram control plane
- Typed Bot API client (10.3-aware, graceful degradation), polling loop, /sessions dashboard,
  /operations list, live operation views editing ONE message with cancel buttons (§36).

### Tests
- 51/51 passing across 4 suites; strict typecheck clean.

## 0.1.0 — 2026-09-09

### Phase 0 — Audit (complete)
- Audited reference repository (417 passing tests, clean strict typecheck), plogme 1.0.3 at
  runtime, and Telegram Bot API changelog (10.3 confirmed current).
- Produced capability matrices and reuse map (docs/REFERENCE_AUDIT.md); audit gates (docs/AUDIT.md).

### Phase 1 — Core foundation (initial)
- Added validated env config (`src/config/env.ts`).
- Added core layer: failure classification (`errors.ts`), identity/LID policy (`identity.ts`),
  permission ladder (`permissions.ts`), command parser with per-session prefix modes and bounded
  self-chain unwrapping (`command-parser.ts`), typed command registry (`command-registry.ts`),
  structured operation events (`logger.ts`), and the shared operation engine
  (`operation-engine.ts`) with progress, cancellation, classified retries, skip semantics,
  operation-scoped delay reconfiguration, and idempotency keys.
- Tests: 20/20 passing (`tests/core.test.ts`); `tsc --noEmit` clean.
