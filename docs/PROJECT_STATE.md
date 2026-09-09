# PROJECT_STATE — SaaS Promoter

> Single source of truth for "where the project is". Every session MUST read this first (spec §53).
> Last updated: 2026-09-09 — Phase 0 complete, Phase 1 foundation in progress.

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
| 1 — Core foundation (parser, prefixes, identity, permissions, errors, operation engine, op-log) | **IN PROGRESS — core modules + tests done** (src/core/*) |
| 2 — WhatsApp transport abstraction | Not started |
| 3 — Link Preview Engine | Not started |
| 4 — Core WhatsApp commands | Not started |
| 5 — Status / Tag / Bulk operations | Not started |
| 6 — Telegram control plane | Not started |
| 7 — Telegram Mini App (where justified) | Not started |
| 8 — Reference feature migration | Not started |
| 9 — UX polish | Not started |
| 10 — Reliability hardening | Not started |

## Verified quality gates (current)

- `npx tsc -p tsconfig.json --noEmit` → clean.
- `npx vitest run` → 20/20 tests passing (parser/prefix/chain, registry, identity/LID, permissions, error classification, operation engine).

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

Continue Phase 1 → Phase 2:
1. Session registry + workspace model (data shapes decided in ARCHITECTURE.md §data-model).
2. plogme capability-gated transport adapter (`transport/plogme-adapter.ts`), using only verified APIs.
3. Listening-lease architecture (§30) as an inbound-admission gate.
4. First commands on the new registry: `.menu`, `.ping` (vertical slice end-to-end).

## Currently being worked on

Phase 1 foundation just landed. Nothing half-finished; safe to continue from "Next recommended task".

## Handoff protocol (every session)

1. Read PROJECT_STATE.md → AUDIT.md → ARCHITECTURE.md → IMPLEMENTATION_PLAN.md → DECISIONS.md → KNOWN_LIMITATIONS.md.
2. Inspect the worktree; reconcile docs with reality before coding.
3. Continue from the actual state; never restart a half-finished feature from scratch.
4. Update PROJECT_STATE.md and CHANGELOG.md at the end of every session.
