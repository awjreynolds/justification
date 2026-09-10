# Promotion TDD evidence

Promotion is the explicit, attributed movement of one child-owned knowledge
node into the project `shared` knowledge base. The node keeps its immutable ID,
creation attribution, content and history. Support and typed relationships
owned by the node's former KB move with it when their other endpoints remain
visible in `shared`; upstream child-owned dependencies are rejected before any
revision is committed. A successful response reports the moved node, the
preserved owned records and an attributed `scopeChange` with `from`, `to`,
`reason`, actor and timestamp.

The first public behavior uses two child KBs and a shared premise. It records a
child claim with an attributed child-owned justification whose premise is the
shared node, and a child-owned typed dependency to that premise. It exports the
child once so the generated child document exists, adds an unrelated human
file beside it, and promotes the claim. The expected outcomes are defined
independently from the implementation:

- the promotion commits one revision and preserves the claim, justification,
  relationship and creation fields while changing their owning scope to
  `shared`;
- the response identifies the same node and owned record IDs and attributes
  the scope change to `human:promoter` with the supplied reason;
- the unchanged sibling can explain the promoted claim, while `why` at the
  pre-promotion revision still returns the child-owned historical explanation;
- the generated child claim document is removed, the generated shared claim
  document is published, and the unrelated human file remains byte-for-byte
  unchanged;
- deleting disposable `.justification/` state and rebuilding does not change
  the current explanation or the historical explanation.

The test is written at the confirmed public runtime seam through
`executeOperation`, with real temporary project directories and file
observations. It does not inspect history internals or recompute support
traversal.

## First cycle: successful promotion

The deliberate RED run was made against the current dispatcher after adding
the public fixture:

```text
npm run build && node --test test/promotion.test.ts
```

The fixture reached the public `promote` call after creating both child KBs,
the shared premise, child claim, child justification, typed relationship and
generated child projection. It then failed because promotion is still an
unimplemented dispatcher operation:

```text
1 test, 1 failure
Error [RuntimeError]: unsupported runtime operation: promote
code: INVALID_REQUEST
test/promotion.test.ts:108
```

This was meaningful RED for the scope-change boundary. The minimum GREEN
implementation validates shared upstream support, moves the node and its
owned support/relationship records with the same IDs, appends a `scopeChange`,
and republishes the whole projection. Whole-project publication removes an
old generated path only after history-derived drift validation; unrelated
human files remain untouched. The focused command passed (`1 test, 1 pass, 0
failures`).

## Second cycle: recorded basis scope rejection

Promotion also validates the references recorded directly on a decision or
artifact node. A child-owned `basis`/`basisGroups` premise is an upstream
dependency even though the runtime also stores the same basis as an original
justification. The public test expects `SCOPE_VIOLATION` with
`{ nodeId, from, to, dependencyId, dependencyKind: "justification_premise" }`, no
revision advance, and the original child explanation still available.

The recorded basis is represented by the same atomic original justification,
so a child-owned basis is rejected as `justification_premise` before any
revision is committed. The public test passed (`2 tests, 2 pass, 0 failures`);
the diagnostic label is kept aligned with the existing support record rather
than manufacturing a separate failure for an equivalent check.

## Third cycle: options and provenance ownership

A decision's `consideredOptions` and `selectedOption` fields are immutable
references just like its recorded basis. A child-owned option must prevent
promotion even when the decision's support premise is shared. The first run
reached the promotion call and failed with `Missing expected rejection` (`2
pass, 1 failure`); the minimum guard now returns `SCOPE_VIOLATION` with
`dependencyKind: "considered_option"` and the focused option test passes.

Captured evidence also retains ownership of its source. Promoting evidence
before its source is shared returns an actionable
`SCOPE_VIOLATION` with `dependencyKind: "source_provenance"`; promoting the
source first then permits the evidence move. The public provenance fixture
verifies both orderings and immutable IDs in the eight-test promotion run.

## Fourth cycle: conflicts and explicit retry

An open child contradiction involving the candidate blocks promotion with
`REVIEW_REQUIRED`. Resolving it permits a later retry, while the contradiction
and its existing review remain owned by the child. The first run reached the
promotion call and incorrectly moved the node (`3 pass, 1 failure`); the
minimum conflict guard, ownership metadata and scoped projection publication
now pass the four-test conflict fixture.

The optional `propositionKey` check finds shared nodes with the same key and a
different body. It creates one durable `promotion_conflict` review per
conflicting ID, leaves the child unchanged, deduplicates an unchanged retry,
and permits promotion after the review is explicitly closed. Caller-supplied
conflict IDs use the same close-then-retry path. The shared and sibling review
queries and generated documents exclude the child-owned review, while the
child index retains its status and closure history. Source cache loss before a
promotion is also covered; historical projection ownership removes only the
obsolete generated child path and leaves human files untouched.

## Fifth cycle: persisted promotion-conflict gate

The caller-supplied conflict fixture adds a public retry with `conflicts`
omitted. After the first attempt commits one open promotion review, an omitted
list must still honor that persisted review. Before the correction, the retry
promoted the child and advanced from revision 4 to revision 5 (`6 passing, 1
failing`), exposing that the request list was being treated as the complete
conflict set.

The minimum correction includes open, child-owned `promotion_conflict` reviews
for the candidate in the promotion conflict plan. The blocked retry now keeps
the exact review ID, returns the same revision with `committed: false`, and
leaves the node in its child KB. Closing that review and retrying with the list
still omitted then promotes successfully. The focused promotion run remains
green (`7 tests, 7 pass, 0 failures`) at this stage.

## Sixth cycle: scoped unchanged captures

The final Spec review reproduced a leak after promoting a source while its
retained evidence remained child-owned. An unchanged `capture_source` request
in `shared` returned the full child evidence node, even though the scoped
`evidence` query omitted it. The public regression extends the provenance
fixture with both a shared and sibling unchanged capture between source and
evidence promotion. Each must return the shared source and retained
observation, no evidence, `changed: false`, `committed: false`, and the same
revision. The original evidence then promotes separately. A subsequent changed
capture exercises the transaction path and returns new shared evidence; the
post-promotion unchanged sibling capture remains a no-op and returns that
shared evidence.

The deliberate RED run used the focused command:

```text
npm run build && node --test test/promotion.test.ts
```

It reached the shared capture and returned the child evidence object instead
of `null` (`7 passing, 1 failing`). The minimum GREEN correction filters the
fast-path and transaction-path capture result by the effective request KB
without changing source identity or promoting evidence implicitly. The
focused verification passed with typecheck and whitespace validation:

```text
npm run typecheck && node --test test/promotion.test.ts && git diff --check
```

The result is green (`8 tests, 8 pass, 0 failures`); shared and sibling
unchanged captures preserve the no-op revision, and the separate evidence
promotion still commits independently.

The final focused promotion run passes (`8 tests, 8 pass, 0 failures`). The
parent separately ran typecheck and the complete suite after this correction:
101 tests passed with no failures.
