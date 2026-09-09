# SaaS Promoter

A premium **Telegram-controlled WhatsApp operations SaaS**.

- **WhatsApp = execution plane.** Group/channel-focused command surface with per-session prefixes,
  rich native interactions, and scoped listening (never a permanent group-wide listener).
- **Telegram = control plane.** Session dashboard, live operation views, operation history,
  settings, and approvals over Bot API 10.3.
- **One core.** Commands, bulk operations, retries, identity, and permissions live in a shared
  engine; both planes are thin clients over it.

## Status

Phase 0 (audit) complete; Phase 1 (core foundation) in progress — see `docs/PROJECT_STATE.md`.

- WhatsApp transport: `plogme` 1.0.3 (verified Baileys fork; capability matrix in
  `docs/REFERENCE_AUDIT.md`).
- Current quality gates: `npm run typecheck` clean, 20/20 tests passing.

## Quality gates

```bash
npm install
npm run typecheck
npm test
```

## Documentation layer (multi-AI handoff, spec §52–53)

Every session starts here, in order:

1. `docs/PROJECT_STATE.md` — what exists, what is next
2. `docs/AUDIT.md` — audit conclusions and gates
3. `docs/REFERENCE_AUDIT.md` — plogme + reference + Telegram capability matrices
4. `docs/ARCHITECTURE.md` — target design and data model
5. `docs/IMPLEMENTATION_PLAN.md` — phase checklist
6. `docs/DECISIONS.md` — decisions and rationale
7. `docs/KNOWN_LIMITATIONS.md` — unverified or risky areas
8. `docs/CHANGELOG.md` — progress log

## Configuration

Copy `.env.example` to `.env` (see `.env.example` for every knob). Secrets never enter logs
(logger redacts) and production startup fails without required secrets.

## Non-goals

No anti-abuse bypass mechanics, no fake capabilities, no unverified APIs presented as supported —
uncertain items are marked UNVERIFIED in `docs/KNOWN_LIMITATIONS.md`.
