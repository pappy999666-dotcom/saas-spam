# PROJECT_STATE — SaaS Promoter

> Single source of truth for "where the project is". Every session MUST read this first (spec §53).
> Last updated: 2026-09-09 — Phases 0–6 core built; runtime wiring (live socket + polling loop) is the next milestone.

## Product identity

**SaaS Promoter** — a NEW, standalone Telegram-controlled WhatsApp operations SaaS.

- WhatsApp = execution plane (group/channel focused, never a DM chatbot).
- Telegram = control/management/monitoring plane.
- WhatsApp transport = `plogme` (verified Baileys fork; capability map in REFERENCE_AUDIT.md).
- The reference project `pappy-panel-smoke` (pappy-omega-mini) is a BLUEPRINT ONLY — it is never
  imported, copied wholesale, or modified. Proven patterns are reimplemented cleanly here.

## Phase status

| Phase | State |
|---|---|
| 0 — Audit (repo, plogme, reference, Telegram API) | **COMPLETE** (see AUDIT.md, REFERENCE_AUDIT.md) |
| 1 — Core foundation | **COMPLETE** (errors, identity, permissions, parser, registry, operation engine, op-log, sessions, leases, renderer, flows) |
| 2 — WhatsApp transport abstraction | **COMPLETE (code)** — capability-gated plogme adapter, normalizer, payload resolver, dispatcher. Live socket soak test pending |
| 3 — Link Preview Engine | **COMPLETE (code)** — discover/fetch/normalize/thumbnail/validate/cache with SSRF guards; live fetch soak pending |
| 4 — Core WhatsApp commands | **COMPLETE (code)** — menu, creategc, glink, leave(+all), pmt/dmt(+aliases), spmt/sdmt, listen, setprefix, setgpp |
| 5 — Status / Tag / Bulk | **COMPLETE (code)** — gstatus(x), togstatus, allstatus(+d), tag, allchat on the shared engine |
| 6 — Telegram control plane | **COMPLETE (code)** — typed Bot API client, poller, dashboard, live op views (single editable message) |
| 7 — Telegram Mini App | Not started |
| 8 — Reference feature migration (Validator Hub, Join Manager, Auto Promote) | Not started |
| 9 — UX polish | Not started |
| 10 — Reliability hardening | Partial (classified retries, idempotency, lease restore done; soak/restart tests pending) |

## Verified quality gates (current)

- `npx tsc -p tsconfig.json --noEmit` → clean.
- `npx vitest run` → **51/51 tests passing** across 4 suites (core, phase2 transport/sessions/ui, preview, bulk/join).
- `npm start` without TELEGRAM_BOT_TOKEN → safe scaffold smoke, exits cleanly.

## What exists in src/ so far

- `src/core/errors.ts` — ClassifiedError, retryable-vs-permanent classification (§44).
- `src/core/identity.ts` — JID/phone/LID normalization; LID never resolves or leaks (§29).
- `src/core/permissions.ts` — owner/sudo/global/none role ladder, ownerOnly gate (§8).
- `src/core/command-parser.ts` — per-session prefix modes (required/optional/none), alias handling,
  bounded self-chain unwrapping (§6, §7, §23).
- `src/core/command-registry.ts` — typed command metadata + categories + normalized CommandContext (§8, §9).
- `src/core/logger.ts` — structured operation-event log with bounded history + redacting logger (§37).
- `src/core/operation-engine.ts` — shared bulk-operation engine: progress, cancellation, classified
  retries, skip semantics, delay re-configuration, idempotency keys (§43–§46).
- `src/config/env.ts` — zod-validated env incl. pairing custom-code validation (§32, §56).

## Next recommended task

1. Runtime wiring: `WhatsAppRuntime` that binds registry sessions ↔ plogme sockets (start/stop/reconnect),
   feeds normalized events into the dispatcher, and binds BulkRuntime.transport to real sockets.
2. Persistence for sessions/workspaces beyond in-memory (file or Mongo) + encrypted auth state.
3. Soak: live pairing + gstatus/allstatus against a real session; verify group-status semantics (L4).
4. Phase 8 migration: Validator Hub, Join Manager, Auto Promote on the operation engine.

## Currently being worked on

Nothing mid-flight. All Phase 0–6 code landed with tests; runtime soak testing is the next milestone.

## Handoff protocol (every session)

1. Read PROJECT_STATE.md → AUDIT.md → ARCHITECTURE.md → IMPLEMENTATION_PLAN.md → DECISIONS.md → KNOWN_LIMITATIONS.md.
2. Inspect the worktree; reconcile docs with reality before coding.
3. Continue from the actual state; never restart a half-finished feature from scratch.
4. Update PROJECT_STATE.md and CHANGELOG.md at the end of every session.
