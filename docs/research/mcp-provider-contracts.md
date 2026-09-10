# MCP and source-change contracts for Justification

Research date: 2026-09-10. Scope: the local, multi-project ADR demonstration described in the original brief. **Recommendations below are proposals for the decision map, not settled implementation choices.** No implementation language is selected.

## Verified protocol baseline

The official `latest` specification resolves to **2026-07-28**. The versioning page labels this revision **Current**, meaning ready for use and open to compatible updates; it distinguishes Current from Draft and historical Final. The May release-candidate announcement is therefore not the maturity label to use today. Unlike `2025-11-25`, the current protocol is stateless: requests declare their version and client capabilities in `_meta`; there is no initialization handshake. Older-client compatibility is a separate requirement. [Versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)

Current servers must implement `server/discover`, returning supported versions, capabilities, and identity. Clients may discover before invoking operations. This discovers protocol facilities, not Justification projects or provider abilities; those need application contracts. [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)

With stdio, the client launches a subprocess. Newline-delimited JSON-RPC travels on stdin/stdout; stdout must contain only protocol messages, while logs may use stderr. Metadata is in the message body. Process restart loses in-flight requests and requires subscriptions to be reopened. One subprocess can route to multiple projects: stdio itself does not impose a project boundary or create a shared daemon across different clients. [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)

Tools expose callable operations, including queries. Servers advertise `tools`, enumerate definitions through `tools/list`, and receive calls through `tools/call`. Current tool lists must not depend on hidden per-connection state. Tool execution failures, including business-rule and argument-value failures, use `isError: true`; malformed protocol requests and unknown tools use JSON-RPC errors. Annotations are hints, not trusted authorization guarantees. [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

Tool results support `content` and `structuredContent`; current structured content can be any JSON value. When `outputSchema` exists, structured results must conform. Serialized JSON in a text block is recommended for compatibility. Completed modern results include `resultType: "complete"`; wire envelopes should be the SDK’s responsibility. [Schema](https://modelcontextprotocol.io/specification/2026-07-28/schema), [structured results](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content)

Resources identify contextual data by URI, with listing, templates, and reads. They suit addressable snapshots or artifacts. A missing resource must produce `-32602`, not an empty contents array; earlier versions used `-32002`. Servers must validate URIs and prevent traversal for `file://` resources. [Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

Roots are deprecated in `2026-07-28`; new implementations should use arguments, resource URIs, or configuration. Even before deprecation, roots were informational, not enforced access controls. [Roots](https://modelcontextprotocol.io/specification/2026-07-28/client/roots)

Official SDKs cover multiple languages and transports. The TypeScript v2 migration documentation concretely describes modern/legacy wire codecs and stdio support; this demonstrates an available compatibility route, not a reason to settle on TypeScript. Neither the current specification nor an SDK tier proves that a user's installed client supports it. This research did not test installed clients or verify a particular released SDK package. [SDK catalogue](https://modelcontextprotocol.io/docs/2026-07-28/sdk), [SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)

**Decision prerequisite:** pin a candidate SDK and run a minimal stdio smoke test in each target client: version discovery/negotiation, tool enumeration, scoped call, structured success/error, and restart. Record client build, SDK version, and negotiated protocol. The current stdio specification documents probing with `server/discover` and legacy `initialize` fallback; do not require `2026-07-28` until client support is demonstrated. Supporting `2025-11-25` through the SDK may be necessary. [Compatibility procedure](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio#backward-compatibility)

## Proposed MCP surface and scope

Use one local runtime with a configured project registry. Begin with tools `projects`, `knowledge_bases`, `context`, `why`, `impact`, `inspect_source`, `refresh`, and `audit`; add mutation/review tools only once their domain decisions are resolved. Optional resources can expose immutable evidence snapshots and ADRs through a project-qualified custom URI. Avoid making resource subscriptions necessary for correctness.

Every scoped operation should require `project_id` and, where applicable, `kb_id`; node identifiers must resolve within that project. Return effective scope, graph revision, bounded results, provenance identifiers, and truncation information. Reject ambiguity; never use a mutable “current project.” Define whether `shared` inheritance is included and mark inherited results explicitly.

Use an object result envelope across protocol versions: `schema_version`, `scope`, `data`, and an optional typed `error` with `code`, `message`, and `retryable`. Define success/error alternatives in the output schema. A refresh that completes but finds unavailable sources should return a successful refresh report containing per-source failures; failure to execute the refresh is a tool error.

The runtime should enforce a configured allowlist, path containment including symlinks, scoped reads/writes, and project-aware cache keys. Treat external document text as evidence, never executable instructions. Local stdio does not itself sandbox its subprocess. MCP’s authorization framework applies to HTTP; stdio implementations should obtain credentials through their environment. Keep provider credentials outside durable project files. [Authorization applicability](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index)

## What change signals establish

| Signal | Verified guarantee or limitation |
| --- | --- |
| HTTP ETag | Opaque representation validator; strong and weak validators differ. `If-None-Match` uses weak comparison and can yield 304. It takes precedence over `If-Modified-Since`. |
| Last-Modified | Modification-time validator, generally weaker than a strong ETag; not a universal change sequence. |
| HTTP absence | 404 may mean undisclosed existence and says nothing about permanence. 410 means access is likely permanently unavailable. |

These are HTTP representation/access semantics, not truth or claim-validity judgments. A changed validator does not prove changed bytes or changed meaning. [RFC 9110 §§8.8, 13.1, 15.5](https://www.rfc-editor.org/rfc/rfc9110.html)

Filesystem timestamps can be set explicitly. Watch behavior varies by platform; Node’s official API documents unreliable network-filesystem watching and Linux/macOS watches remaining attached to an old inode after delete/recreate. Thus mtime/size and watcher events are screening hints, not a complete revision history. This is a platform caveat, not a language recommendation. [File timestamps and watch caveats](https://nodejs.org/api/fs.html#caveats)

Git distinguishes commits, trees, blobs, and symbolic refs. Record repository identity, full object ID, hash algorithm, and path; do not hardcode SHA-1 length. `git diff` reports additions/deletions/modifications and similarity-based renames. A branch moving or a commit changing does not establish that a particular source changed; compare the relevant path/blob. [Revision/object formats](https://git-scm.com/docs/git-rev-parse), [diff semantics](https://git-scm.com/docs/git-diff)

## Proposed provider contract and first adapter

Prefer a **file provider over explicitly registered UTF-8 source documents** for the first ADR demonstration: offline, reproducible edits and deletion, no authentication or variable remote representations. The source files remain external to compiled KB state. A small read-only HTTP provider is a useful next comparison because it exercises validators and failures, but adds redirects, representation selection, timeouts, and outbound-address policy. An HTTP source provider is independent of the MCP transport choice.

Start with `resolve`, `fetch`, and explicit advertised capabilities; optional `version`, `changedSince`, `fetchChanges`, `query`, and `watch` must not imply support when absent. Give every source a stable application ID plus provider instance, project, locator, and selector. Keep identity separate from content hash: identical content can occur at different sources; changed content can remain the same source. Treat renames as delete/add unless identity is explicitly preserved.

Fetch should return a tagged outcome: `present`, `not_modified`, `missing`, `gone`, `unavailable`, or `denied`, with observation time, revision/validator, content type, and diagnostics. Define exact bytes hashed and the algorithm, preferably SHA-256; retain raw-byte identity separately from any versioned text normalization. For the small file corpus, hash every explicit refresh. Detect reads changing during capture and retry or report unavailable; do not publish a torn snapshot. Equal hashes suppress repeated interpretation; different hashes produce candidate changes, not automatic contradictions.

For HTTP, preserve request variant and credential partition with validators; conditional GET is preferable to separate HEAD/GET. A 304 needs the matching cached snapshot; without it, fetch unconditionally. Missing validators require hashing a successful body. Retain the original locator alongside redirect destinations.

Make cursor reset explicit: opaque cursors are bound to provider, scope, and generation. Expiry, history rewrite, or lost baseline triggers complete reconciliation, never “no changes.” Only infer deletion from a successful complete inventory or explicit removal event. Permission errors, partial scans, and timeouts preserve prior evidence as historical/unverified. Commit reconciled observations before advancing cursors; deduplicate replayed events by stable event identity or source/revision. Persist mutation idempotency keys with their outcome so a retry after process failure does not duplicate graph changes. JSON-RPC request IDs alone are not this guarantee.

## Remaining decisions

Confirm whether local files satisfy “one external provider”; choose target MCP clients and required legacy support; settle path/rename identity, snapshot retention, concurrent-process ownership, and the minimum human-reviewed interpretation flow. Acceptance should cover unchanged bytes, changed bytes, deletion/reappearance, permission failure, reset, and duplicate refresh while showing only the affected claim, decision, and ADR need review.
