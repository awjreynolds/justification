# Choose durable authority and an honest OKF compatibility boundary

Type: grilling
Label: wayfinder:grilling
Mode: HITL
Status: resolved
Assignee: awjreynolds
Parent: [Find the route to a traceable Justification MVP](../map.md)
Blocked by: 01, 05, 06, 08

Prerequisites: [Establish which Open Knowledge Format specification the MVP can target](01-okf-compatibility.md); [Define the minimum evidence and justification model](05-minimum-domain.md); [Separate freshness, belief and review state without rewriting history](06-state-review.md); [Define shared inheritance, explicit promotion and project isolation](08-scope-identity.md)

## Question

What exactly is canonical: Markdown/YAML records, an event journal, or another durable representation? Choose a single authority and define how OKF projects or serializes it, how unknown fields survive round trips, and what a no-runtime reader retains. Decide which revisions/excerpts and interpretation inputs must remain durable to reproduce historical `why` results; operational cursors and cached fetches cannot be the only evidence store. Resolve hand-edited files versus runtime-owned mutations, merge/conflict recovery, atomic multi-file updates, deterministic index rebuilds, schema migration, retention/deletion policy and separation of credentials/private runtime state. Decide whether a full event ledger earns its MVP cost or immutable revision records are sufficient.

## Answer

Resolved by agent decision on 2026-09-10 under the user’s later instruction to continue until complete while away. This is not a claimed human answer to the earlier HITL question.

One append-only project history is authoritative: numbered digest-linked complete JSON snapshots committed atomically under a lock. OKF v0.2/profile-v1 Markdown is a readable current projection in one project-wide kb bundle. Index/poll state is disposable. Diagnose hand edits and corruption; explicit repair rebuilds projections. Native history backup preserves semantics; arbitrary third-party import/roundtrip and automatic Git history merge are deferred. See ADR 0001.
