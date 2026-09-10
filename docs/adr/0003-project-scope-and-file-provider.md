# ADR 0003: Project scope and a bounded file provider

Status: accepted for MVP under the user's completion instruction, 2026-09-10.

An ADR needs local working knowledge while sharing project constraints. Sharing must not duplicate evidence or accidentally expose sibling/project knowledge. The first adapter must prove deterministic change detection without requiring credentials or a remote service.

Use immutable project-local node IDs and one level of KB inheritance. Each child sees itself and `shared`. References must target visible nodes. Cross-project dependencies are rejected. Visibility does not broaden a proposition's subject, version or time applicability. Promotion is explicit and preserves identity/history; it requires upstream dependencies to be shared and exposes conflicts for review instead of overwriting shared knowledge.

The first knowledge provider reads UTF-8 files inside an explicitly selected project root. Project-relative locators make native projects portable. Resolve symlinks before use and reject root escape and runtime-managed state. Captures retain observation content and a revision digest; source files remain authoritative for current source observations.

On-demand refresh compares deterministic content/state signals before creating semantic changes. Retain new observations for changed content, distinguish missing from unavailable, and traverse declared dependencies to create review work. Unchanged refresh is idempotent across restarts and index rebuilds. The runtime records affected knowledge; it does not silently reinterpret source text.

Provider capability metadata and a separate adapter interface leave room for versioned remote resources later. Watchers, scheduled jobs, webhook delivery, remote credentials and source-system-specific indexing remain outside this proof. Whole-artifact file digest tracking detects ADR drift; sentence-level anchoring is deferred.
