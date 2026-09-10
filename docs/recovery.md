# Native backup and recovery

The native project is the combination of its persisted descriptor, append-only
history and generated knowledge projection. Keep these paths together when
moving or backing up a project:

```text
project-root/
├── justification.json
├── justification-history/
│   ├── 000000000000.json
│   ├── 000000000001.json
│   └── ...
├── kb/
│   ├── shared/
│   └── <child-kb>/
└── .justification/          # disposable derived index and observations
```

The numbered JSON revisions under `justification-history/` are authoritative.
Each complete snapshot is linked to its predecessor by revision and digest and
has an integrity digest. The `kb/` tree is the current readable OKF projection;
it is useful to a generic Markdown reader but cannot replace native history.
The `.justification/` directory is disposable. Source files referenced by the
file provider remain outside runtime-managed directories and should be backed
up separately when they are needed for future refreshes.

## Rebuild a disposable index or projection

If `.justification/` is missing, stale or disposable state is suspected, run the
runtime rebuild operation. The same operation is available through the CLI:

```sh
justification run /path/to/project - <<'JSON'
{"op":"rebuild","actor":"operator"}
JSON
```

For an existing generated projection, rebuild derives it from validated native
history. It does not turn a hand-edited Markdown file into semantic authority.
After rebuilding, repeat the affected `why`, `impact`, `trace` or `audit` query
with an explicit `evaluationTime`; a fixed historical `revision` should produce
the same explanation before and after rebuild.

If a mutation reports `PROJECTION_FAILED`, the semantic revision has already
been committed and must be preserved. Keep the history, inspect the diagnostic,
and run `rebuild` after addressing the filesystem problem. Do not retry by
editing or deleting a committed revision.

## History and metadata failures

The runtime validates the project descriptor and every history revision before
using it. These typed errors identify the recovery path:

- `ProjectError` with `MALFORMED_METADATA`, `UNSUPPORTED_METADATA`,
  `INVALID_STRUCTURE` or `INVALID_ROOT` means the descriptor/root cannot be
  used. Restore `justification.json` and the `kb/shared/` directory from a
  native backup, then run `projects` or `init` to validate the structure.
- `StorageError` with `HISTORY_CORRUPT` or `INVALID_HISTORY` means a revision is
  unreadable, has an unsupported format, breaks the digest chain or does not
  match the persisted project identity. Stop writes, copy the entire project
  for diagnosis, and restore the descriptor plus complete
  `justification-history/` from a known-good native backup. An OKF export cannot
  repair missing historical revisions.
- `StorageError` with `CONCURRENT_WRITE` means the project lock is present. A
  lock is a safety boundary, not a failed transaction: confirm that no
  Justification process is still writing before removing the lock file, then
  retry. If a writer is active, wait for it to finish.
- `StorageError` with `PROJECTION_FAILED` means history is intact but the
  current projection could not be written. Preserve the committed revision and
  use `rebuild` after correcting the reported filesystem issue.

Never use a broad recursive delete to clear a project. The only disposable
state is `.justification/`; removing `justification-history/`,
`justification.json`, `kb/` or source files discards information or provider
content.

## Provider and runtime errors

`ProviderError` reports source-specific problems. `INVALID_LOCATOR` means the
locator is absolute, escapes the project root, points into managed runtime
state, or is not a regular file. `UNSUPPORTED_CONTENT` identifies content the
file provider cannot retain. `PROVIDER_UNAVAILABLE` means the source could not
be read or resolved; the source observation remains a durable unavailable or
missing state rather than silently becoming false.

`RuntimeError` reports invalid requests and graph invariants, including
`NOT_FOUND`, `INVALID_SCOPE`, `SCOPE_VIOLATION`, `INVALID_NODE`,
`INVALID_JUSTIFICATION`, `SUPPORT_CYCLE`, `INVALID_RELATIONSHIP`,
`INVALID_PROVENANCE`, `CONFLICT`, `REVIEW_REQUIRED`, `PROJECTION_DRIFT` and
`AUDIT_FAILED`. Preserve the error's `code`, message and JSON-safe `details`
when diagnosing a failed operation; do not infer a successful semantic write
from a partial transport response.

## Native restore and portability

Restore the native files to an empty project root, keep source locators relative
to that root, and run `rebuild` before querying. The descriptor's project ID and
the history's project ID must agree. Rebuilding is deterministic from validated
history and does not require the previous disposable index.

An `export` result explicitly identifies its history limitation. Use it for a
current readable OKF handoff. Use native files when historical `why` results,
review provenance, digest-linked observations or future refreshes must remain
available.
