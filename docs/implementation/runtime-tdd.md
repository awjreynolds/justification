# Runtime TDD evidence

This note records the bounded runtime cycles completed by the implementation
agent. The domain, storage, provider and serializer foundations were written
before the first runtime behavior was exercised; they are foundation code and
are not retroactively claimed as TDD evidence. The public behavior tests use
temporary real project directories and the file-backed history implementation.

## Cycle 1: shared knowledge base discovery

Behavior: after `initializeProject(root)`, a public `knowledge_bases` operation
reports the shared knowledge base.

The deliberate red run used the public test before dispatch was implemented:

```text
Error [RuntimeError]: runtime operation is not implemented
code: INVALID_REQUEST
```

The smallest green implementation loads or creates durable revision `0`,
validates the optional scope, and returns the persisted project and shared KB
descriptor. The focused run passed the existing 13 bootstrap tests and this
behavior test (`14 passed, 0 failed` in the selected run).

## Cycle 2: child knowledge base creation and persistence

Behavior: `create_kb` creates a named child inheriting `shared`, commits one
history revision, and makes it visible to a later `knowledge_bases` call after
the same runtime is reopened.

The test was first run against the dispatcher's deliberate unsupported-operation
path and failed with the existing `INVALID_REQUEST` / `runtime operation is not
implemented` error. The minimum green implementation added validated child IDs,
parent lookup, safe `kb/<id>` directory creation, an append-only revision `1`,
expected-revision checking, and listing of the new child plus inherited shared
knowledge. The focused run passed all 15 tests (`15 passed, 0 failed`).

## Foundation corrections and export

These cycles followed review of the first two slices.

| Behavior | Red result | Green result |
| --- | --- | --- |
| A pre-existing `justification-history` symlink must not redirect writes outside the project | `knowledge_bases` unexpectedly succeeded and wrote revision 0 through the symlink; the focused test reported `Missing expected rejection` | `StorageError(HISTORY_CORRUPT)` after `lstat` rejects a history-directory symlink; revision files and lock entries receive the same guard |
| `export` emits a readable OKF projection and preserves unrelated KB files | `RuntimeError(INVALID_REQUEST): unsupported runtime operation: export` | Current root index parses as OKF v0.2, delimiters are valid, KB `index.md` is plain Markdown, unrelated files survive, and the focused run passed `24` tests |
| Integrity-valid history with dangling KB, source, observation, justification or relationship references is rejected | The five independent fixtures were accepted; the focused test reported `Missing expected rejection` | `StorageError(HISTORY_CORRUPT)` validates IDs, KB parents, node/source/observation links, justification groups and relationship endpoints before graph use; focused run passed `25` tests |
| Nested KB parent and inherited-object-key scope errors | Nested child creation was accepted; `kb: "toString"` widened into an empty result | Nested parents now fail with `INVALID_SCOPE`; inherited object keys fail with `NOT_FOUND`; focused runs passed `26` and `27` tests |

A stale `expectedRevision` regression was also run against `create_kb`; the
existing guard passed immediately and durable revision remained unchanged
(`28` tests passed). No new red result is claimed for that already implemented
check.

## Export collision correction

Review found that a first export could overwrite a human-created
`kb/shared/index.md`. The new public regression was run before the fix with:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='human-owned generated destination'
```

It failed with `Missing expected rejection`, and the human bytes had been
replaced. The minimum fix preflights every generated destination, rejects
unowned existing files, and only writes after all targets pass. The same
command then passed with no root index, manifest, or human-byte changes. A
follow-up focused run:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='export (writes|refuses)'
```

passed all `29` tests. The export fixture now also places an integrity-valid
retained claim in durable history and independently parses its concept
frontmatter, while checking the reserved root and KB index rules.

The domain-reference fixture was strengthened after its initial green run so
each case has valid neighboring data: a source fixture has a valid node beside
the invalid source link, an observation fixture has a valid source beside the
invalid source ID, the justification fixture has a valid conclusion with only
the premise dangling, and the relationship fixture has one valid endpoint.
This was coverage enhancement, not a new historical red. The focused command
was rerun and passed all `29` tests:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm test -- --test-name-pattern='dangling domain references'
```

The currently implemented runtime operations are `knowledge_bases`,
`create_kb`, and `export`. The remaining operation discriminants are typed and
documented for transport integration but still fail as unsupported until their
own red test is run. This keeps later work aligned with the one-behavior
red/green sequence in `docs/planning/tdd-plan.md`.
