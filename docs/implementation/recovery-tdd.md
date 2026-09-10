# Recovery and rebuild TDD evidence

This note defines the first public recovery slice before its implementation.
The durable numbered history remains the semantic authority. Rebuild validates
that history, regenerates disposable state and the current generated
projection, and never commits a semantic revision.

## Public response shape

`executeOperation(root, { op: "rebuild", actor? })` returns the normal
`{ revision, data }` envelope:

```json
{
  "revision": 7,
  "data": {
    "rebuilt": true,
    "committed": false,
    "revision": 7,
    "index": {
      "path": ".justification/index.json",
      "digest": "<sha256 of the regenerated index>"
    },
    "projection": {
      "files": ["kb/index.md", "kb/shared/index.md"],
      "manifestDigest": "<sha256 of the regenerated manifest>"
    }
  }
}
```

The two revision members identify the same validated semantic snapshot. The
outer member follows the runtime response convention; the data member makes
the no-new-revision guarantee explicit to callers. `index.path` and
`index.digest` identify disposable derived state. `projection.files` is the
sorted set of generated files written or confirmed by rebuild, and
`manifestDigest` identifies ownership metadata for those files. Neither
disposable result is semantic authority, and a rebuild failure must leave the
validated history available for diagnosis.

## Cycle: deterministic rebuild and native restore

The first public behavior uses a real file capture, an attributed claim, an
explicit justification from the retained evidence, and a decision whose
original basis is that claim. It records a fixed evaluation time for `why`,
captures generated documents, removes the complete `.justification/` tree,
and calls `rebuild`. The assertions cover the public response shape, unchanged
semantic revision, fixed-time explanation equivalence, reproducible generated
documents, disposable index and manifest regeneration, preservation of an
unrelated KB file, and rebuilding a native copy containing the descriptor,
history, source and unrelated KB file.

The test intentionally does not claim coverage for every recovery edge case.
Missing individual generated documents, manually edited projections,
projection failure recovery and malformed history are separate behaviors.

The deliberate RED run used the pinned Node 24.21.0 toolchain:

```text
PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  npm run build && \
  PATH=/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH \
  node --test test/recovery.test.ts
```

The build passed, then the one recovery test failed at the first unsupported
public operation:

```text
Error [RuntimeError]: unsupported runtime operation: rebuild
code: INVALID_REQUEST
test/recovery.test.ts:101
```

This is a meaningful RED: initialization, file capture, claim recording,
support recording, decision basis recording and fixed-time `why` all reached
the rebuild call through the public dispatcher. No production recovery code
has been added after this run.

The minimum green implementation adds one dispatcher branch immediately before
`export`. It validates the complete current history under the project lock,
derives a deterministic `.justification/index.json` from that revision,
rebuilds the projection with the revision's committed timestamp, and returns
the unchanged revision. The focused run then passed:

```text
1 test, 1 pass, 0 failures
```

The serializer accepts missing generated files during rebuild and derives
ownership from validated current projection paths plus the committed
timestamp when the disposable manifest is absent. Existing files still need
to match those derived bytes; a manual edit therefore remains a projection
drift requiring explicit export repair. Known generated paths are the only
manifest entries retained or inspected.
