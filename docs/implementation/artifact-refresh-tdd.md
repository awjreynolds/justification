# Artifact refresh TDD evidence

Artifact files have a durable accepted digest on the artifact node. Refreshing
the selected KB must inspect those real project-relative files, retain the
accepted node and file bytes, and record one durable `artifact_drift` review
when an observed file state differs. Rechecking the same state must not append
another revision or review, including after disposable cache rebuild.

## First cycle: artifact drift review

The public fixture records a shared artifact against an explicitly accepted
assumption, changes the artifact file, and calls an unqualified source refresh
scoped to the shared KB. It expects one open review with
`triggerType: "artifact_drift"`, unchanged artifact digest and unchanged file
bytes. It then repeats the same refresh, deletes `.justification/`, rebuilds,
and repeats the refresh again to verify durable deduplication and history.

The deliberate RED run used the pinned Node 24.21.0 source-runtime path:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/artifact-refresh.test.ts
```

The real artifact fixture reached the refresh operation, which then only
selected source records. It returned the existing revision with no change, so
the first artifact-drift assertion failed:

```text
0 pass, 1 failure
AssertionError: 2 !== 3
test/artifact-refresh.test.ts:70
```

This is a meaningful RED: the test uses a real contained file, verifies the
accepted digest and bytes independently, and exercises the public refresh,
review, rebuild and history boundaries. No artifact refresh production hook or
domain change had been added when that RED was observed.

Before the green implementation, the fixture's byte assertions were corrected
from `assert.equal` to `assert.deepEqual`; Node Buffer equality by identity
would otherwise make the post-refresh preservation check fail independently of
the runtime behavior. The observed RED remains the refresh operation's missing
artifact-drift behavior above.

The first implementation turned that test GREEN with the same pinned runtime:

```text
> justification@0.1.0 build
> tsc -p tsconfig.build.json && node -e "require('node:fs').chmodSync('dist/cli.js', 0o755)"

✔ refresh records and durably deduplicates artifact drift reviews
ℹ tests 1
ℹ pass 1
```

The implementation stores artifact transitions in optional semantic
`artifactDrifts` history, and links each review to its drift record. A later
public regression covers the distinct transition sequence `B → accepted A →
B`: restoring accepted bytes commits a transition without opening a review,
and the next return to `B` commits a second transition and opens a new review.
The focused run passed all five public artifact refresh tests:

```text
✔ refresh records and durably deduplicates artifact drift reviews
✔ refresh retains restoration before reopening a later distinct artifact drift
✔ refresh durably deduplicates a missing artifact state across rebuild
✔ refresh durably deduplicates an invalid UTF-8 artifact state across rebuild
✔ refresh isolates child artifacts and sourceIds select sources without artifact probes
ℹ tests 5
ℹ pass 5
```

The missing-file and invalid-UTF-8 cases were added as focused verification
after the first GREEN. Each records the unavailable state, repeats refresh,
rebuilds the disposable cache, repeats refresh again, and then changes the
file back to present bytes; the later state creates new review work. The scope
case verifies that a refresh for one child cannot create reviews for the other,
and that `sourceIds` suppresses artifact probing until an unqualified refresh.
