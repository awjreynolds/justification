# Knowledge actions, queries and audit review

Two independent GPT-6 Astra reviewers at medium examined the fixed change
`02bd0ea...4542674`, following the repository's Standards and Spec review axes.
The primary agent separately ran the pinned Node v24.21.0 typecheck and full
test command at `4542674`: 86 tests passed, with no failures.

## Spec findings

1. **P2 — Review closure retries without `at` are not idempotent.** Repeating
   the same actor/rationale closure with the current expected revision creates
   a fresh timestamp before comparing metadata, producing `CONFLICT`.
   Recognize an omitted timestamp as a retry and retain the first closure time.
   Status: closed by independent re-review of `7ac5c22`.
2. **P2 — A child conflict with two shared endpoints has no readable home.**
   The runtime accepts the record but returns no reviews, and neither endpoint
   projection includes its identifier or rationale. Either give this shape a
   child-owned projection/review or reject it before committing. Status:
   corrected by rejecting this shape with `SCOPE_VIOLATION` before commit;
   independent re-review of `7ac5c22` closed the finding.

The reviewer reproduced both findings through the public runtime in an
isolated archive of the fixed commit. No additional concrete byte-budget or
audit containment defect was established.

## Standards findings

No new blocking Standards findings. The reviewer found realistic temporary
project fixtures and independent expected values. Immediately passing
byte-boundary, scope and cycle checks are recorded as verification, separately
from observed failing behavior and subsequent implementation.

The reviewer recommended one shared review-visibility policy: query summaries
check both the target and its triggering record, while runtime review surfaces
currently check the target. Verify sibling scope across public query, review,
why and audit surfaces, including after promotion, before final acceptance.
This was a maintenance recommendation; no existing public leak was reproduced
by that review. A contradiction test-count narrative typo is being corrected
without inventing execution evidence.

The primary agent independently ran the four knowledge-actions tests after
both corrections: all four passed. They check unchanged semantic revisions,
the retained closure timestamp and preserved readable projection bytes.

Spec re-review repeated both original reproductions in an isolated archive of
`7ac5c22`. It also checked that an explicitly different closure timestamp still
returns `CONFLICT` and that rejected conflicts leave history files unchanged.
Both findings are closed. The primary agent ran typecheck and the full suite
from an isolated archive of the same commit: 87 tests passed with no failures.
