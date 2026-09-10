# ADR 0001: Durable revisions and readable OKF projections

Status: accepted for MVP under the user's completion instruction, 2026-09-10.

Historical explanations must survive new observations, index deletion and source disappearance. A mutable Markdown graph alone would require a second history mechanism. An opaque database alone would leave the user dependent on the runtime to recover knowledge.

Store authoritative semantic state in append-only, numbered JSON revisions under `justification-history/`. Each revision contains a complete snapshot, attribution and a digest-linked predecessor. Serialize writes with a project lock and atomically commit a revision file. Validate references and integrity before exposing state. This is a compact local history format, not an implementation of event sourcing or a distributed merge protocol.

Compile current state into readable Markdown/YAML under `kb/`, using the pinned [OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md) and a versioned `justification` extension. One project is one bundle. Generic readers retain sources and reasoning links; native history is needed for historical explanations. Isolate serialization from runtime semantics. The [research](../research/okf-compatibility.md) records the exact compatibility boundary.

Disposable indexes and polling state live under `.justification/`. They must be reconstructible from history and cannot override it. A recorded observation digest is durable evidence identity; a last-checked timestamp is operational state. No credentials belong in either compiled knowledge or its history.

This favors inspectability and a small atomic commit boundary at the expense of storage growth. Full snapshots are acceptable for an MVP; compaction, retention and migrations need later explicit formats. Branching or corrupt histories fail visibly. Generated-file drift is diagnosed, and an explicit rebuild/repair can recover projections from validated authority. Git merges of divergent histories need deliberate reconciliation; they must never silently select a winner.

Native backups include `justification.json`, `justification-history/` and `kb/`; source files remain provider-owned and should be backed up separately if required. An OKF-only export is a current view, not a full-history backup.
