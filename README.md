# SaaS Promoter

A high-scale, production-oriented **Telegram-controlled WhatsApp operations SaaS** engineered to support 1,000+ concurrent users with zero session conflicts.

- **WhatsApp = execution plane.** Group/channel-focused command surface with per-session prefixes,
  rich native interactions, designed status aesthetic engine (`_gstatusd`, `_allstatusd`), and scoped listening (never a permanent group-wide listener).
- **Telegram = control plane.** Session dashboard, live operation views with draft streaming, operation history,
  settings, and approvals over Bot API 10.3.
- **One core.** Commands, bulk operations, retries, identity, and permissions live in a shared
  engine; both planes are thin clients over it.

## Status

Phase 0 (audit) complete; Phase 1 (core foundation) complete; Phase 2 (designed status aesthetic engine) implemented — see `docs/MASTER_PLAN.md` and `docs/PROJECT_STATE.md`.

- WhatsApp transport: `plogme` 1.0.3 (verified Baileys fork; capability matrix in `docs/REFERENCE_AUDIT.md`).
- Multi-Tenant Scale: Designed for up to 1,000 users with distributed workload panel isolation.
- Quality gates: TypeScript strict compilation clean, all Vitest test suites passing.

## Documentation Layer (Multi-AI Handoff Protocol)

Every session starts here, in order:

1. `docs/MASTER_PLAN.md` — master architectural blueprint, designed status specification, and AI handoff guide
2. `docs/PROJECT_STATE.md` — what exists, what is next
3. `docs/AUDIT.md` — audit conclusions and gates
4. `docs/REFERENCE_AUDIT.md` — plogme + reference + Telegram capability matrices
5. `docs/ARCHITECTURE.md` — target design and data model
6. `docs/IMPLEMENTATION_PLAN.md` — phase checklist
7. `docs/DECISIONS.md` — decisions and rationale
8. `docs/KNOWN_LIMITATIONS.md` — unverified or risky areas
9. `docs/CHANGELOG.md` — progress log
