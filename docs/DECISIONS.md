# DECISIONS.md — architecture and product decisions with rationale

D1. **New standalone project** (user-directed, 2026-09-09). SaaS Promoter is a new bot; the
    reference tree is never modified or imported. Rationale: clean architecture, no legacy
    branding/telemetry, freedom to apply spec §8/§43 designs without regression risk.
    Consequence: proven patterns are reimplemented with tests, not copied.

D2. **Pairing custom code**: spec requests `saas-spam`, but plogme enforces exactly 8 chars
    (verified in lib/Socket/socket.js). Default is `SAASPROM` (8 chars). If the user wants a
    different code it must be 8 letters/digits; "saas-spam" is REJECTED by the transport —
    do not fake it (spec §32).

D3. **Telegram client**: build a thin typed Bot API 10.3 client instead of telegraf 4.x.
    Rationale: telegraf predates Rich Messages/ephemeral/draft streaming; Bot API is plain HTTPS,
    so a small typed client is less risk than an untyped mega-client. Feature-detect 10.3 methods
    and degrade gracefully where the account lacks them.

D4. **Listening = leases, not global handlers** (§30). Inbound admission drops non-leased,
    non-command group traffic early. Sending never depends on listening.

D5. **Prefixless mode only recognizes known command names** (§33) so normal conversation is
    never intercepted. Verified by tests in tests/core.test.ts.

D6. **Self-chaining tags** (§23): parser unwraps nested known-name commands with a hard cap
    (MAX_CHAIN_DEPTH = 3); beyond the cap the text is treated as payload, never looped.

D7. **Subsystems excluded from MVP**: music/play/lyrics/a2v, games, Digital OS demo surfaces.
    Rationale: not in spec; external API dependencies; demo artifacts. Revisit only by decision.

D8. **plogme pinned to 1.0.3** with the option of a local patch directory if the unbounded-cache
    issue (observed in the reference's patch) appears under load.

D9. **Operations claim nothing early** (§18/§50): a target is completed/skipped/failed/cancelled
    explicitly; cancellation mid-target records "cancelled", not "failed" and not "completed".
    Enforced by tests.
