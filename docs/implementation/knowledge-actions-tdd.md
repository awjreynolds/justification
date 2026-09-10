# Knowledge actions TDD evidence

This note records the bounded review, contradiction and typed-relationship
actions that follow the source-maintenance and read-query slices. The first
cycle covers review closure only. Contradiction recording/resolution and
relationship mutation remain separate red–green cycles after this gate.

## Review closure payload

The existing `review` operation remains the read form when called with only
`status` and/or `kb`:

```json
{
  "revision": 7,
  "data": {
    "reviews": [
      {
        "id": "review-id",
        "nodeId": "claim-id",
        "triggerType": "change",
        "triggerId": "change-id",
        "reason": "source observation changed",
        "status": "open",
        "createdBy": "human:refresh",
        "createdAt": "2026-09-10T14:00:00.000Z"
      }
    ],
    "changes": [],
    "scope": { "kb": "shared" }
  }
}
```

Closing one review uses the mutation form:

```json
{
  "op": "review",
  "reviewId": "review-id",
  "status": "closed",
  "rationale": "Rechecked the retained observation and accepted the remaining review work.",
  "actor": "human:reviewer",
  "at": "2026-09-10T15:00:00Z",
  "expectedRevision": 7
}
```

The first closure commits one semantic revision and returns:

```json
{
  "revision": 8,
  "data": {
    "review": {
      "id": "review-id",
      "nodeId": "claim-id",
      "triggerType": "change",
      "triggerId": "change-id",
      "reason": "source observation changed",
      "status": "closed",
      "createdBy": "human:refresh",
      "createdAt": "2026-09-10T14:00:00.000Z",
      "closedBy": "human:reviewer",
      "closedAt": "2026-09-10T15:00:00.000Z",
      "closureRationale": "Rechecked the retained observation and accepted the remaining review work.",
      "closureHistory": [
        {
          "status": "closed",
          "actor": "human:reviewer",
          "at": "2026-09-10T15:00:00.000Z",
          "rationale": "Rechecked the retained observation and accepted the remaining review work."
        }
      ]
    },
    "committed": true,
    "idempotent": false
  }
}
```

The closure record keeps its original trigger, reason and creation
attribution. Repeating the same closure against the already-closed review is
idempotent: it returns the unchanged semantic revision and the unchanged
review with `committed: false` and `idempotent: true`; it does not append a
second history entry. A stale `expectedRevision` still returns `CONFLICT`
before mutation.

Closure acknowledges review work only. It does not rewrite retained evidence,
make stale support usable, alter a node's truth value or resolve a contradiction.
When a later distinct source change affects the same node, the runtime creates
a new open review with the new change trigger and preserves the earlier closed
review and its closure history.

## First cycle: close a source-change review

The public fixture captures a real source, justifies a claim from its retained
evidence, changes the source and refreshes it. It closes the claim's review
with an actor, rationale, timestamp and expected revision, then checks the
closure metadata/history, unchanged stale-support assessment, idempotent
repetition and a later distinct open review. Expected review IDs and trigger
IDs are derived from the observed records but compared as exact independent
sets; no support traversal is reimplemented in the test.

The test was written before the mutation implementation. The initial run was
meaningful RED: after `npm run build`, `node --test
test/knowledge-actions.test.ts` failed at the first closure because the read
handler returned `INVALID_REQUEST` for review mutation fields (0 passing, 1
failing). The minimum implementation added a typed closure entry, durable
closure-history validation, a lock-aware no-op transaction result for repeated
closures, and the public close handler. The same command is now GREEN (1
passing, 0 failing). The implementation also leaves the semantic revision
unchanged for an identical repeated closure and keeps later source-change
reviews distinct.

## Second cycle: record and resolve a scoped contradiction

The contradiction fixture records an explicit conflict between an inherited
shared claim and a child claim. The contradiction is owned by the child scope,
so a shared `conflicts` query returns no record while the child query returns
the attributed rationale and endpoints. The mutation creates child review work
only; a shared `why` response, search flags and shared projection therefore
contain neither the child node ID nor the private rationale. Resolution is
explicit: missing or out-of-endpoint supersession winners are rejected,
directional and scope resolutions remain attributed in `resolutionHistory`,
and `unresolved` records its rationale while returning the contradiction to
`open` status. Resolution does not alter support or node content.

The first implementation run was meaningful RED: `node --test
test/knowledge-actions.test.ts` passed the review fixture but failed the new
fixture at request validation because `contradict` did not accept its scoped
KB (2 passing, 1 failing). The minimum implementation added scoped
contradiction records, conflict listing, resolution history and winner checks,
scope-filtered contradiction reviews/projection, and dispatcher handlers. The
same command is GREEN with 3 passing and 0 failing after the relationship
fixture was added below; the contradiction scenarios pass within that focused
run. The fixture also verifies resolved and subsequently open contradiction
metadata in the owning child projection, plus the closed source review's
closure history in its owning node document.

## Third cycle: typed relationships

`relate` stores an attributed typed edge owned by the source node's KB. A child
edge may point to inherited shared knowledge, while sibling child endpoints
are rejected. Ordinary relationship cycles remain legal and `trace` terminates
with visited paths; a child-owned edge is omitted from a shared trace.

The first relationship run was meaningful RED: `node --test
test/knowledge-actions.test.ts` passed the prior two fixtures but failed at the
new `relate` call with `INVALID_REQUEST` for the unsupported operation (2
passing, 1 failing). The minimum implementation added ownership and endpoint
scope validation, durable relationship validation, and the public handler.
The focused command is now GREEN with 3 passing and 0 failing.

## Projection-readable maintenance status

The projection fixture then asserted the generic Markdown body independently
of YAML: a closed review must show its review reason and closure rationale,
and an owning conflict document must show its open/resolved status plus every
resolution rationale. Before the rendering change, `npm run build && node
--test test/knowledge-actions.test.ts` was RED with 1 passing and 2 failing;
the frontmatter assertions passed but both body assertions were absent. The
minimum serializer change adds scoped `## Review status` and `## Conflicts`
sections with readable IDs, statuses, reasons, links and attributed closure or
resolution rationale. The same focused command is now GREEN with 3 passing and
0 failing, while shared and sibling documents continue to omit child-owned
details.
