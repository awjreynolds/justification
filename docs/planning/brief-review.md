# Justification: brief review and candidate route

Status: planning proposal, not an approved implementation specification.

The purpose is coherent: preserve the justification for consequential project knowledge while keeping external systems authoritative. The first deliverable should prove a traceable ADR and selective impact after a source change. There is no application to redo yet: the repository started with only an MIT licence and README. The revisions below address ambiguity and missing contracts in the supplied brief before they become expensive code changes.

The canonical decision map is [Find the route to a traceable Justification MVP](../../.scratch/justification-mvp/map.md). Questions live in its child tickets; this document explains the initial critique and a candidate route, and does not resolve those questions. [The original brief](original-brief.txt) is preserved verbatim. Research findings can resolve factual prerequisites; proposals still require the corresponding design decision.

## What should remain

- Own justification and provenance, with source systems retaining their authority.
- Local-first, readable durable knowledge; disposable derived indexes.
- One runtime and MCP server for explicitly selected projects and KBs.
- Shared inheritance without copying, explicit promotion, and visible conflicts.
- Deterministic change detection before selective reassessment.
- Historical accountability: supersession and attributed resolution instead of silent replacement.
- An ADR as the first end-to-end proof; no UI, vector database, hosted service or large provider catalogue.

## Areas to revise before implementation

| Area | Gap or inconsistency | Recommended revision to investigate | Decision |
| --- | --- | --- | --- |
| MVP scope | “Self-maintaining” suggests semantic autonomy, but the minimal list only establishes storage and traversal. | Make the first proof deterministic capture, tracing, change detection and review flagging, with supplied reasoning. Add interpretation later behind an explicit interface if acceptable to the user. | [Agree the smallest ADR demonstration that proves the product](../../.scratch/justification-mvp/issues/04-mvp-proof.md) |
| Evidence | The MVP names Source/Claim/Decision/Artifact but omits Evidence; a mutable URL cannot establish what a past decision relied on. | Represent an immutable observation/revision and its attribution separately from source identity. Decide whether Evidence and SourceRevision are separate records or one small record. | [Define the minimum evidence and justification model](../../.scratch/justification-mvp/issues/05-minimum-domain.md) |
| Requirements and assertions | The acceptance scenario records requirements and traces artifact assertions, neither of which appears in the MVP list. | Explicitly support these concepts, perhaps as typed claims and stable ADR anchors; otherwise narrow the demonstration honestly. | [Define the minimum evidence and justification model](../../.scratch/justification-mvp/issues/05-minimum-domain.md), [Choose artifact assertion anchors and acceptable drift behavior](../../.scratch/justification-mvp/issues/11-artifact-contract.md) |
| Meaning of `why` | Reachability over generic `supports` edges does not explain a decision's inference. | Store attributed rationale and enough support structure to distinguish jointly required inputs from alternatives. Return gaps and uncertainty with paths. | [Define the minimum evidence and justification model](../../.scratch/justification-mvp/issues/05-minimum-domain.md) |
| State model | `verified`, `supported`, `disputed`, `invalid`, `superseded` and `needs-review` mix different dimensions. A claim can have support and also be disputed. | Separate attributed assessments, computed support, source freshness/availability and review workflow. Define who verified what, when, against which evidence. | [Separate freshness, belief and review state without rewriting history](../../.scratch/justification-mvp/issues/06-state-review.md) |
| Change propagation | The example can read as automatically downgrading truth after any source update. Independent support and non-semantic changes make that unsafe. | Distinguish potential impact from an accepted semantic revision. Conservative review is useful; automatic falsehood or contradiction resolution is not justified by a change signal. | [Separate freshness, belief and review state without rewriting history](../../.scratch/justification-mvp/issues/06-state-review.md), [Define a deterministic provider and selective-refresh transaction](../../.scratch/justification-mvp/issues/09-refresh-contract.md) |
| Durable authority | Markdown, an optional event ledger and compiled OKF projections could become competing sources of truth. | Choose one canonical semantic authority. Define retained evidence, revision history, export/import limits and rebuild inputs before implementing persistence. | [Choose durable authority and an honest OKF compatibility boundary](../../.scratch/justification-mvp/issues/07-persistence-authority.md) |
| OKF promise | The brief names a format without a publisher, version or conformance target. | Verify the intended specification; pin a version/profile and round-trip tests. Keep domain storage behind an adapter, and disclose any lossy export. | [Establish which Open Knowledge Format specification the MVP can target](../../.scratch/justification-mvp/issues/01-okf-compatibility.md), [Choose durable authority and an honest OKF compatibility boundary](../../.scratch/justification-mvp/issues/07-persistence-authority.md) |
| Mutation model | “Readable Markdown” permits user editing in practice; “use runtime operations” alone cannot make multi-file changes safe. | Define how edited files are validated/imported, how writes recover after interruption, and whether concurrent writers are serialized or rejected. Reject broken state explicitly. | [Choose durable authority and an honest OKF compatibility boundary](../../.scratch/justification-mvp/issues/07-persistence-authority.md) |
| Scope | Inheritance is specified, but visibility, proposition applicability, overrides, promotion identity and discovery boundaries are not. | Distinguish where knowledge is visible from the subject/version/time it describes. Make KB lookup and project isolation explicit; a child must not silently override shared knowledge. Preserve lineage through promotion. | [Define the minimum evidence and justification model](../../.scratch/justification-mvp/issues/05-minimum-domain.md), [Define shared inheritance, explicit promotion and project isolation](../../.scratch/justification-mvp/issues/08-scope-identity.md) |
| Provider interface | A list of optional methods does not define behavior when an adapter lacks a capability or a source disappears. | Use declared capabilities and normalized outcomes. Define cursor commits, retries, duplicate changes, unavailable versus deleted sources, and revision identity. | [Define a deterministic provider and selective-refresh transaction](../../.scratch/justification-mvp/issues/09-refresh-contract.md) |
| MCP completeness | The candidate tools focus on retrieval but leave new evidence/claims/decisions and links without a complete write path. | Expose a small coherent set of runtime operations with schemas, errors and explicit project/KB IDs. CLI and MCP use the same semantics. | [Specify the runtime, CLI and bounded MCP contract](../../.scratch/justification-mvp/issues/10-runtime-mcp.md) |
| Context budgets | “Smallest relevant trusted context” lacks a definition and model-independent exact token counting is not specified. | Promise deterministic bounded selection with source references, conflicts, omissions and a declared tokenizer or conservative budget unit. Trust is an explicit policy/assessment. | [Specify the runtime, CLI and bounded MCP contract](../../.scratch/justification-mvp/issues/10-runtime-mcp.md) |
| Artifact drift | A document can change while a link still points at the same path or line number. | Start with an ADR version plus explicit assertion anchor/content digest, or document whole-artifact granularity. Edited text must not silently inherit another sentence's justification. | [Choose artifact assertion anchors and acceptable drift behavior](../../.scratch/justification-mvp/issues/11-artifact-contract.md) |

## Candidate architecture

Research has now established factual inputs, without selecting the architecture:

- The best match for OKF is Google Cloud's canonical `open-knowledge-format`, whose inspected specification is v0.2. It has path-based identity, untyped links and permissive extensions, so Justification's IDs, support semantics and review state need an explicit compatibility profile. See [the compatibility research](../research/okf-compatibility.md) and [the pinned primary specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md).
- PROV and truth-maintenance concepts help separate origin from evidential support. Joint premises and alternative justifications need different treatment; KB visibility must not broaden a proposition's applicability. See [the semantics research](../research/justification-semantics.md), [PROV-DM](https://www.w3.org/TR/prov-dm/) and [the original ATMS paper](https://www.dekleer.org/Publications/An%20Assumption-Based%20TMS.pdf).
- The researched current MCP specification is 2026-07-28. Client and released-SDK compatibility still need practical verification, so the map now includes a client-baseline decision and a disposable compatibility task before locking the runtime contract. See [the protocol/provider research](../research/mcp-provider-contracts.md) and [official versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning).

The seams below are proposals to evaluate, independent of implementation language or exact on-disk schema.

```text
CLI / one MCP server / optional agent skill
                    |
Runtime application operations
  project/KB resolution · capture/link · why/impact · refresh · review
                    |
Domain rules
  identity · scope · provenance · support · revision · contradiction
          /                         \
Durable state adapter         Provider adapters
  records/history               resolve/fetch/change capability
  portable projection           authoritative source references
          |
Disposable query indexes + separate private operational state
```

Transport handlers should call runtime operations rather than mutate files or indexes themselves. Provider output and imported documents are data; instructions contained in them must not gain authority to mutate unrelated knowledge or trigger tools. Explicit project roots and scoped operations matter because one runtime serves multiple projects.

The initial semantic boundary should be modest. An external agent may propose a claim, interpretation or conflict resolution, with provenance and actor identity. The runtime validates structure, scope and revision rules and records the proposal/accepted action according to the eventual review contract. It does not acquire truth merely because a model generated a statement.

Durable evidence is different from a fetch cache. A past `why` result needs the exact retained observation, or an honest indication that only its immutable reference/digest survives. An operational cache may disappear without changing semantic facts. Define retention and import redaction at capture time so credentials, signed URLs and unnecessary private source content do not accidentally become committed project knowledge.

For deterministic rebuilds, define equivalence at the query level rather than requiring a byte-identical SQLite file. Any time-sensitive freshness calculation needs an explicit evaluation time and durable policy; operational `last_checked` data alone cannot recreate a historical assessment. A rebuild must report invalid durable records instead of silently inventing missing facts.

## Candidate first demonstration

Use a synthetic ADR selecting between two options under an explicit constraint. Keep fixtures free of private data and external model dependencies.

1. Initialise a project, create `kb/shared`, and create a child KB for the ADR. Discover this project through an explicit configured root.
2. Capture a source and a versioned observation; record a claim and its rationale under a shared constraint.
3. Record a decision referencing the relevant claims and rejected alternative; attach an ADR with an explicit assertion or declared whole-artifact link.
4. Ask `why` for the decision/ADR and get inspectable paths to the original observation and source, including scope and assessment limits.
5. Change the upstream source. A cheap check produces a normalized ChangeSet; dependency traversal identifies the potentially affected claim, decision and ADR.
6. Create or update a review issue without erasing the prior observation, rewriting the decision, or claiming that a changed source proves the claim false.
7. Repeat refresh: no duplicate semantic revision or review issue for the same change. Keep an unrelated KB unchanged.
8. Delete the derived index and rebuild. At the same evaluation time, `why`, `impact`, unresolved conflicts and review state remain equivalent.
9. Resolve a review explicitly and retain the resolution history. Introduce a later relevant change and confirm that fresh review work is visible.

The first external provider remains a decision. Local files offer a reproducible base; a narrowly scoped HTTP source is a candidate for proving external change detection. A controlled test server can exercise changed, unchanged, unavailable and missing-source responses reproducibly without making the public demo depend on an arbitrary website.

## Candidate build sequence after decisions

These are implementation stages, not Wayfinder decision tickets. They become executable work only after their contracts and acceptance criteria are settled.

| Stage | Intended result | Completion evidence |
| --- | --- | --- |
| Foundation | Minimal schema, runtime invariants, durable adapter, init and KB creation. | A readable fixture validates; malformed references and conflicting writes have explicit outcomes. No unused ontology. |
| First trace | Capture observations, claims, a constraint, decision and ADR; implement scoped `why` and `impact`. | The ADR traces to the exact evidence version; unrelated projects/KBs stay outside results; cycle/limit behavior is explicit. |
| Source refresh | First provider, ChangeSet normalization, affected-subgraph traversal and review creation. | No-change, changed, deleted and unavailable fixtures; replay is idempotent; historical evidence survives. |
| Conflict and promotion | Explicit contradiction review, shared inheritance, promotion and supersession rules. | Shared/child conflict, competing supports and repeat-review fixtures; no silent overwrite or false downgrade. |
| Public interface | Package CLI and one local MCP server over the tested runtime, with needed writes and bounded queries. | A real MCP client drives the same ADR scenario across two projects, with structured failures and explicit scope. |
| Rebuild and handoff | Cold rebuild, documentation, examples and optional agent skill. | Remove all derived indexes/caches and reproduce durable semantics; install and run from documented commands; review remaining limitations. |

Do not postpone all transport integration to the end: prove an MCP smoke path once the first runtime operation exists, then expand the contract with each slice. Likewise, test rebuild invariants as soon as durable state exists and keep the final stage as an end-to-end check.

For every implementation stage, delegate concrete file/module ownership to **gpt-5.6-luna at max**, then have **gpt-6-astra at medium** review the actual diff against the resolved decisions and meaningful tests. Return findings to Luna; Astra reviews material corrections. Record unresolved findings and evidence instead of declaring success because an agent completed a turn. Avoid concurrent work on shared storage/schema files until their interfaces are stable.

## Likely ADRs once decisions are made

Only write accepted ADRs after a real choice with tradeoffs has been made. Likely candidates are durable authority/OKF compatibility, the support-and-review model, and scope/promotion identity. Runtime language, package layout or the first adapter need ADRs only if the choice proves hard to reverse or surprising.

## What makes the plan ready

The map is complete when its research and human decision tickets are resolved, its remaining fog is either specified or explicitly outside the MVP, and the handoff contains concrete schemas, operations, fixtures and review gates. A completed research report or this candidate build sequence alone does not meet that bar. The first human decision is [Agree the smallest ADR demonstration that proves the product](../../.scratch/justification-mvp/issues/04-mvp-proof.md); exact implementation details should follow that decision and the research.
