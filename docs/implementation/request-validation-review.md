# Request validation and clean-checkout review

Two independent Astra-medium reviews inspected committed
`8432583...cb78b64` on 2026-09-10. The range contains the shared runtime/MCP
schemas in `48cfca5` and the fresh-checkout import correction in `cb78b64`.
Ongoing refresh and recovery edits were outside this review.

## Standards

The review found no additional material test-quality or maintainability issue.
It confirmed one process deviation: after the first observed rejection cycle,
several validation clauses were prepared before their tests. The existing
[evidence](request-validation-tdd.md) distinguishes sensitivity checks and
already-green verification from historical TDD. This deviation cannot be
repaired retrospectively; subsequent corrections must follow the required
observed-red/minimum-green sequence.

The clean-checkout correction preserves actual compiled CLI/MCP process tests.
Its reported verification used an archived revision without `dist/`, a fresh
locked dependency installation, typecheck and all 54 tests. The original
hosted failure and local reproduction are recorded in [CI evidence](ci-baseline.md).

## Spec findings awaiting correction

1. Calendar validation accepted `2026-02-30t00:00:00Z` and normalized it to
   March 2 because an unmatched timestamp spelling skipped the calendar check.
   Require the supported timestamp grammar before accepting its components.
2. Operation names inherited from `Object.prototype`, including `constructor`,
   retrieved a non-schema value and threw a `TypeError`. Use own-property lookup
   and preserve the stable `INVALID_REQUEST` error for unsupported operations.
3. Artifact locator/digest fields were accepted on ordinary claims, allowing an
   uncaptured nonexistent file to appear in exported source metadata. Validate
   caller fields by node kind so artifact-file handling cannot be bypassed.

The Spec reviewer reproduced all three against an isolated committed build.
Each correction needs a public regression, minimum implementation, and review
before this review can be considered closed.
