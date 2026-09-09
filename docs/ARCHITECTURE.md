# ARCHITECTURE.md — SaaS Promoter target architecture

Living document. Update whenever a structural decision changes.

## 1. System overview

```
+-----------------------------+        +----------------------------------+
| Telegram control plane      |        | WhatsApp execution plane         |
| (Bot API 10.3 client)       |        | (plogme sessions via adapter)    |
|  - session dashboard        |        |  - scoped listening leases (30)  |
|  - live operation views     |        |  - command parser (prefix modes) |
|  - operation history        |        |  - permission resolver           |
|  - settings (global vs      |        |  - payload/quote/media resolver  |
|    session-scoped)          |        |  - rich response renderer        |
+-------------+---------------+        +----------------+-----------------+
              |          \                          |        /
              |           \                         |        /
              |            +--------- Operation Engine (shared) ----+
              |                      id, type, session, targets,    |
              |                      policy, scheduler, retry,      |
              |                      progress, cancel, idempotency  |
              |                                  |
              |                       Structured operation events (37)
              |                                  |
              +----------- persistence layer (sessions, operations,
                          history, settings; storage backend pluggable)
```

Both planes are thin clients over the same core. Neither plane implements scheduling,
classification, or identity logic itself.

## 2. Source layout (target)

```
src/
  index.ts                 entry
  config/env.ts            validated env
  core/
    errors.ts              failure classification (done)
    identity.ts            JID/LID/phone policy (done)
    permissions.ts         role ladder (done)
    command-parser.ts      prefix modes + chain unwrapping (done)
    command-registry.ts    typed command metadata (done)
    operation-engine.ts    bulk operation framework (done)
    logger.ts              structured op events (done)
  sessions/                session registry, workspaces, leases
  transport/
    plogme-adapter.ts      capability-gated plogme wrapper
    message-normalizer.ts  inbound WhatsApp -> normalized context
    payload-resolver.ts    media/quote/type resolution
    outbound.ts            send paths + preview integration
  preview/                 Link Preview Engine (Phase 3)
  commands/                one module per command family (Phase 4+)
  telegram/                Bot API client + feature modules (Phase 6+)
  ui/                      response renderer, cards, pagination (both planes)
plogme/ (optional)         local fork overrides, e.g. bounded caches
```

## 3. Data / state model

- **Workspace** — owner (Telegram user), global sudo list, global settings. Telegram-scoped state.
- **Session** — one paired WhatsApp account per workspace (n supported): name, phone, prefix config,
  sudo list, lease state, transport state. Session settings NEVER leak into global settings (§35).
- **Operation** — id, type, workspace, session, targets, policy, counters, status, startedAt.
  Persisted for history; live view reads the in-memory handle; history reads events.
- **Lease** — {sessionId, scope (chat/group), purpose, expiresAt}. Expired lease = stop consuming
  that group's events for command purposes; sending stays available at all times (§30).
- Prefix config per session: `{ prefix: string, prefixMode: "required" | "optional" | "none" }`.
  Telegram bridge has its own independent config (§7).

## 4. Listening architecture (§30)

Inbound WhatsApp events pass through an admission gate:
1. Session paired + healthy? (else: ignore for command purposes; send paths unaffected)
2. Event carries a command/interaction OR a lease is active for that chat? (else: drop early)
3. Permission resolver; owner-gated commands; sudo scopes.
4. Bounded per-session queue; priority for interactive events.

"Listening" is therefore always scoped and lease-bounded — never a permanent group-wide handler.

## 5. Operation engine semantics (implemented in Phase 1)

- One `startOperation(def, executeTarget)`; targets execute sequentially with configurable delay.
- Each target → completed | skipped | failed (classified), plus cancelled on cancel.
- Retry only for retryable kinds (network/timeout/rate_limited) with exponential backoff +
  server hint; permanent kinds fail once and are never hammered.
- Idempotency keys prevent duplicate execution of the same logical operation.
- Live progress = snapshot(); events = typed stream for Telegram live views and future dashboards.
- Delay re-configuration mid-run is operation-scoped (§21) — one operation can never overwrite
  another's scheduler state.

## 6. Link Preview Engine (Phase 3 design, from reference)

DISCOVER -> FETCH (bounded redirects, timeout) -> NORMALIZE (canonical URL, metadata pick)
-> THUMBNAIL (sharp normalize; never store incomplete) -> VALIDATE -> READY -> CACHE.
- Cache entries versioned (`previewCacheVersion`); invalid/corrupt artifacts never reused.
- Concurrency-capped; failure TTL short; success TTL long; single-flight per URL.
- The renderer (not each command) decides when a response gets a preview (§26).

## 7. Security posture (§56)

Secrets only via env; logger redacts token/secret/credential keys; auth state encrypted at rest;
no raw JIDs/LIDs/stack traces in user-facing output; every administrative action passes the
permission resolver; Telegram callbacks re-check role before acting.
