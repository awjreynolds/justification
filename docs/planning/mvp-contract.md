# MVP implementation contract

Decision date: 2026-09-10. The user subsequently instructed “Continue until complete. Going afk”. This authorizes completion of the original MVP and routine design decisions without waiting at the earlier planning gates. Decisions below are the agent's implementation choices under that instruction; they are not answers attributed to the user. The confirmed TDD seams and Luna max / Astra medium model choices continue to apply.

The user later clarified that the product concerns knowledge, tracing decisions
and creating knowledge outputs. This is the general product scope throughout
this contract. An ADR is the first acceptance example from the original brief,
not a specialized runtime entity or required output format. Research briefs,
reports, plans, proposals and other outputs use the same knowledge graph;
knowledge capture and reuse do not require creating a decision or document.

## Acceptance scenario

Initialize two projects. In one, create a child ADR KB, capture file-provider observations about three options, record a shared constraint and locally attributed claims, justify a decision, and reference an ADR. Explain the ADR through the decision and claims to retained evidence and its authoritative file locator. Modify one source and refresh: report the exact affected evidence, claim, decision and artifact, preserving the original explanation at its revision. Repeated unchanged refresh creates no duplicate work. A surviving alternative justification remains usable even while the original basis requires review. The other project is unaffected. Restart and delete/rebuild the index: queries at a fixed revision are equivalent. Exercise these operations through one MCP server serving both configured project roots.

## Small domain and support rules

Use project-local immutable UUID identities and explicit KB IDs. `shared` is visible in every child; a child sees itself and shared, never siblings. Inheritance controls visibility, not proposition applicability. Cross-project graph links are rejected in this MVP.

Nodes have `id`, `kb`, `kind`, `title`, Markdown `body`, attributed `createdBy` and `createdAt`, and optional structured applicability (`subject`, `version`, `validFrom`, `validUntil`). Node kinds are source, evidence, claim, assumption, requirement, question, option, decision, action, artifact and assertion. They share a small record, with kind-specific fields where needed. Attribution does not certify truth. A source has a provider locator; retained evidence pins the source, provider revision/hash and observed text. A decision identifies considered/selected options and its rationale. An artifact may record a project-relative file locator and content digest. Recording a decision/artifact requires explicit basis references, atomically records its basis relationships and retains the acceptance revision. Historical explanation distinguishes that recorded basis from alternatives added later; current support can evaluate both.

Justifications are attributed records with nonempty `premises`, a `conclusion` and a rationale. Premises are AND; multiple groups are alternatives (OR). Refuse support cycles. `derived_from` and contextual relationships never automatically count as sufficient support. Ordinary typed links may cycle; traversals terminate. Explicit artifact/decision dependency links contribute to impact. Evidence currently matching its source and expressly accepted assumptions/requirements can ground a declared argument; an unsupported claim cannot. A changed/missing/unavailable source makes a retained observation's basis pending, not false. An unchanged refresh after temporary unavailability can restore availability while outstanding review remains visible.

Usable support means an attributed declared basis is currently available. It is not machine verification of a proposition or entailment. Applicability mismatches or expired bounds prevent a group from being advertised as usable. Evaluation time must be explicit/controllable for reproducible queries. Unknown applicability must remain visible; no semantic entailment is inferred from arbitrary prose. Reject malformed bounds and unsupported input fields rather than silently dropping them.

Contradictions are explicit attributed objects naming two visible nodes, rationale and resolution history. No semantic automatic contradiction detection is promised. Resolutions are supersession in either direction, different scopes, different times, source error, or unresolved, with actor and rationale. Open contradictions remain visible independently of freshness/support.

Review issues identify affected node, triggering change/contradiction and reason. Closing requires actor and rationale and preserves history; a later distinct change creates or reopens review. Dedupe unchanged refresh. Acknowledging a review does not refresh old evidence, rewrite a decision or resolve a contradiction. Re-evaluation by an agent records new claims/justifications explicitly; the runtime never makes an LLM call.

Promotion is an attributed explicit scope change preserving ID/history. Allow it only when the node's upstream dependencies are already shared; return an actionable scope error otherwise. Conflicts explicitly supplied by the caller, or differing bodies under the same optional proposition key in shared, create a review and leave the child unchanged pending explicit resolution. Do not guess semantic equivalence by title.

## Storage authority and directory layout

`justification.json` retains the existing project identity. `kb/shared/` and `kb/<child>/` hold readable compiled OKF documents. The entire `kb/` tree is one OKF bundle, permitting portable child/shared links. A versioned Justification extension preserves immutable domain identity independently of the OKF path identity.

Use a project-level append-only transaction directory, `justification-history/`, as authoritative durable semantic state. Each atomically committed numbered JSON revision contains a complete state snapshot, previous revision digest, actor/action/time, format version and integrity digest. Full snapshots deliberately favor a small, inspectable implementation over storage efficiency. Readers validate the sequence, versions, integrity and domain references; corruption fails explicitly. A revision contains KBs, nodes, source observations, justifications, relationships, changes, contradictions and reviews. Old revisions are never rewritten. Historical query parameters select a committed revision, not a reconstructed guess about wall-clock time.

Serialize writes under one exclusive project lock; reject concurrent writes with a typed busy error and support optional expected-revision checking. A leftover crash lock fails closed with a documented operator recovery procedure. Validate the complete proposed transaction before committing. Durable state is never in the disposable cache. Projection failure after a committed revision must be reported distinctly, with rebuild recovery instructions; it must not pretend the semantic transaction failed to commit.

`.justification/` contains disposable derived index and operational observations (last checked, polling hashes, retry state) and is ignored by Git. Content digests retained as evidence identity/integrity belong in semantic history; transient HTTP/file polling validators do not. Credentials are neither needed nor persisted by the first provider. Rebuild derives the index solely from validated history and is deterministic. Reads must not trust a stale or corrupt index over durable state.

Compiled documents target pinned OKF v0.2 commit `ad30107c31c06aec8a7d5636e0d1058118604e6f`: UTF-8 Markdown, YAML `type`, optional standard `generated`, `sources`, and `status` using upstream meanings. Put typed links, support groups, provenance, states and stable IDs in `justification` profile version 1. Render essential links and reasoning in the body for generic readers. Keep the serializer separate from graph logic. Do not misuse OKF `status` for epistemic states.

The committed history plus projections is the portable native project. Generic OKF exports expose current readable knowledge; exporting an OKF projection alone does not preserve the complete revision history. Native backup/restore uses the durable project files and has rebuild equivalence. Arbitrary third-party OKF import, legacy migration and lossless editing through generic OKF tools are outside this MVP. Manual edits to generated projections must be diagnosed, not silently treated as authoritative. Explicit projection repair may regenerate them from history. Preserve unrelated files in KB directories.

## Runtime boundary and operations

Keep existing `initializeProject(root)` and `discoverProjects(roots)`. Add a single exported `executeOperation(root, request)` with a typed operation union and typed domain errors; use the same dispatcher in CLI/MCP so semantics have one owner. Responses are JSON-serializable and include revision where applicable. All node references are immutable IDs. Every mutation names an actor; no implicit trust upgrades.

Minimum operations:

| Operation | Required observable behavior |
| --- | --- |
| `knowledge_bases`, `create_kb` | List scoped KB descriptors; create child inheriting shared. |
| `record` | Record an attributed immutable node and optional typed provenance/dependency links; validate kind fields. |
| `justify`, `relate` | Add attributed grouped support or typed link after scope/reference/cycle validation. |
| `capture_source` | Retain a real file observation as evidence with stable source identity and provider revision. |
| `inspect_source`, `evidence` | Inspect source identity and immutable retained observations/provenance. |
| `why` | Return original upstream nodes, groups and provenance with current support/review assessment; optional historical revision and evaluation time. |
| `impact`, `trace` | Return conservative downstream dependencies with traversable paths/reasons; source includes its observations. |
| `refresh`, `changed` | Deterministically detect changes; retain new observations, changes and affected reviews; enumerate recorded changes. |
| `context`, `search` | KB-scoped bounded relevant results, distinguishing supported, assumed, disputed and pending material. A budget must bound output rather than merely accept an argument. |
| `contradict`, `conflicts`, `review` | Record/query conflicts and explicit resolutions; list/close review with preserved attribution. |
| `promote` | Apply the promotion rules above. |
| `audit` | Report unsupported consequential nodes, missing provenance, freshness problems, contradictions, reviews and artifact drift. |
| `rebuild`, `export` | Rebuild disposable index; export current readable OKF projection with explicit history limitation. |

The implementation may refine field names and result shapes consistently, documenting them before transport integration. Do not add empty placeholders for listed behavior. Scope all queries/refresh by project; where KB is supplied honor inherited visibility consistently.

## File provider and refresh

Provide an isolated `KnowledgeProvider` interface with provider ID/mode/change semantics and supported capabilities, initially `resolve`, `fetch`, `version`/digest and `validate`. Implement a UTF-8 file provider using project-relative locators. Resolve paths and symlinks and reject escape from the explicitly configured project root; reject directories and excessive/binary content with useful errors. Source files may be anywhere inside the project outside runtime-managed state. The provider owns source content; Justification owns captured observations and relationships.

Explicit refresh hashes the source deterministically. Unchanged content and availability state create no new semantic revision/change/reviews. Changed content creates a new retained observation and ChangeSet, marks prior evidence historical for current assessment and traverses only declared downstream dependencies for review. Missing, unavailable and restored are durable provider-state transitions, not deletion or falsehood. Repeated checks of the same state are idempotent. Unchanged state after restart/rebuild must stay deduplicated using durable source revision and availability, not rely solely on polling cache. Artifact file changes create an artifact-drift review. Scheduling/webhooks and remote-provider credentials remain extension points.

## CLI and MCP

Retain `init` and `projects`; add `justification run <project-root> <request.json|->` for all runtime operations and `justification mcp <project-root>...` for a single stdio MCP server. Human convenience commands are optional. JSON stdout and typed errors on stderr preserve scriptability. MCP must reserve stdout for protocol traffic.

The server discovers only roots explicitly supplied at launch, assigns project IDs from persisted metadata, and resolves requests by those IDs; no arbitrary request-time filesystem roots. Expose high-level operations with actual JSON schemas, structured results and stable errors, including mutation operations needed for the ADR scenario. Use the verified stable SDK and document actual supported negotiated protocol versions. A current SDK client test and installed Codex client smoke must validate tool discovery/calls and multiple projects. Stdio is the first transport; HTTP/auth/multi-user tenancy are deferred.

## Delivery limits

This proves deterministic justification maintenance supplied by agents/humans. It does not implement a theorem prover, autonomous semantic interpretation, remote provider catalog, sentence-range anchors, semantic conflict detection, UI, scheduler service or vector search. Whole-artifact traceability is the initial artifact granularity. Include a runnable ADR example, public operation reference, native backup/recovery instructions, optional agent skill, automated checks and honest review evidence before reporting completion.
