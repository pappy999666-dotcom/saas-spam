# KNOWN_LIMITATIONS.md — what is not verified, not supported, or risky

## Transport (plogme 1.0.3)

- L1. Custom pairing codes are exactly 8 chars; spec's `saas-spam` is impossible without faking
      (rejected; see DECISIONS.md D2).
- L2. plogme ships loose typings; every socket call is duck-typed at runtime. Mitigation: single
      capability-gated adapter (Phase 2). Until then, no socket call sites outside it.
- L3. Stock 1.0.3 LID/libsignal caches may be unbounded under heavy group traffic (reference repo
      patched this). Watch memory in soak tests before production claims.
- L4. Group-status delivery at scale and album/composite sends are UNVERIFIED live; do not promise
      them in UX until exercised against a real session.

## Telegram

- L5. Bot API 10.3 methods (Rich Messages, ephemeral, draft streaming) may be account-gated;
      the client must feature-detect and degrade. Nothing user-facing may assume 10.3 exists.
- L6. Mini App origin hardening (since 2026-07-20) pins the Mini App to one origin; hosting plan
      must precede Phase 7 work.

## Product / spec tensions

- L7. Spec asks for "no unnecessary listeners" AND instant command response in arbitrary groups;
      leases (§30) are the resolution. If a user expects always-on command listening in every
      group, that is a product decision to revisit explicitly (DECISIONS.md), not a bug.
- L8. Smart-promote (§13) manual-assistance code flow depends on WhatsApp accepting a scoped,
      expiring code mechanism — UNVERIFIED. Marked REQUIRES IMPLEMENTATION OR ALTERNATIVE; do not
      ship UI promising it until proven.
- L9. `.join` "text file input" (§15) requires document media intake; capability confirmed for
      documents, but bulk ingestion UX is deferred to Phase 4/5.

## Process

- L10. Reference tree is outside this repo and may change underneath us; re-verify any pattern
       ported from it against REFERENCE_AUDIT.md before relying on it.
