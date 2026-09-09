# IMPLEMENTATION_PLAN.md — phases and current plan

Follows spec §54. Update this file as phases progress; PROJECT_STATE.md tracks the tip.

## Phase checklist

- [x] **Phase 0 — Audit** (complete): repository, plogme runtime, reference project, Telegram 10.3.
      Deliverables: AUDIT.md, REFERENCE_AUDIT.md, capability matrices, reuse map.
- [~] **Phase 1 — Core foundation** (in progress):
  - [x] env validation, logger, error classification, identity/LID, permissions
  - [x] command parser (prefix modes, aliases, bounded chains) + typed registry
  - [x] operation engine (progress/cancel/retry/skip/idempotency) + structured op events
  - [ ] session/workspace registry + persistence shape
  - [ ] listening leases (§30)
  - [ ] response renderer skeleton (platform-neutral cards)
- [ ] **Phase 2 — WhatsApp transport**: plogme adapter (capability-gated), message normalizer,
      payload/quote/media resolver, mention resolver, outbound paths, pairing flow (QR + code).
- [ ] **Phase 3 — Link Preview Engine** as a standalone subsystem.
- [ ] **Phase 4 — Core WhatsApp commands**: menu, creategc, leave family, pmt/dmt (+ aliases),
      spmt/sdmt, join/joind — all on the new registry + engine.
- [ ] **Phase 5 — Status/Tag/Bulk**: gstatus family, togstatus(x), allstatus(x)+delay, tag family,
      togctag(x), allchat(x)+delay — one operation engine, zero duplicated schedulers.
- [ ] **Phase 6 — Telegram control plane**: typed Bot API 10.3 client, session dashboard,
      live operation views (draft streaming / ephemeral where appropriate), history, settings.
- [ ] **Phase 7 — Mini App** where it beats chat UX (dashboard); respect origin hardening.
- [ ] **Phase 8 — Reference feature migration**: Validator Hub, Join Manager, Auto Promote,
      profile/group tools — redesigned presentation, preserved semantics.
- [ ] **Phase 9 — UX polish** audit of every screen/message.
- [ ] **Phase 10 — Reliability**: reconnect/restart/duplicate/expired/cancel/concurrent scenarios.

## Next actions (ordered)

1. Session/workspace registry with prefix config + lease state (data model in ARCHITECTURE.md §3).
2. Transport adapter + normalizer (Phase 2 start), pairing flow with custom code from env.
3. Vertical slice: `.menu` + `.ping` end-to-end on WhatsApp, verified by tests.
4. Response renderer (cards §50) used by that slice from day one.

## Testing strategy (§55)

Every subsystem lands with unit tests (see tests/core.test.ts as the standard). Integration
checkpoints: parser suite (done), operation engine suite (done), transport adapter against a
mock socket, preview engine against fixture HTML, Telegram client against a fake Bot API server.
