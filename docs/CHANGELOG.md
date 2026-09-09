# CHANGELOG.md

## 0.1.0 — 2026-09-09

### Phase 0 — Audit (complete)
- Audited reference repository (417 passing tests, clean strict typecheck), plogme 1.0.3 at
  runtime, and Telegram Bot API changelog (10.3 confirmed current).
- Produced capability matrices and reuse map (docs/REFERENCE_AUDIT.md); audit gates (docs/AUDIT.md).

### Phase 1 — Core foundation (in progress)
- Added validated env config (`src/config/env.ts`).
- Added core layer: failure classification (`errors.ts`), identity/LID policy (`identity.ts`),
  permission ladder (`permissions.ts`), command parser with per-session prefix modes and bounded
  self-chain unwrapping (`command-parser.ts`), typed command registry (`command-registry.ts`),
  structured operation events (`logger.ts`), and the shared operation engine
  (`operation-engine.ts`) with progress, cancellation, classified retries, skip semantics,
  operation-scoped delay reconfiguration, and idempotency keys.
- Tests: 20/20 passing (`tests/core.test.ts`); `tsc --noEmit` clean.
