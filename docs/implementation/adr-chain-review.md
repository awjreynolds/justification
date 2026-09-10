# ADR chain review

Two independent gpt-6-astra agents at medium reviewed the fixed range
`a104b70...fd7af95` on 2026-09-10. The bounded scope was file capture, immutable
records, grouped justification, historical explanation and readable export.
Later refresh/review/index operations were explicitly outside this slice.
The parent independently ran typecheck and all 34 tests successfully.

## Spec findings

1. **P1 — Shared conclusions allowed child-only support.** A justification in
   child A could attach its local assumption to a shared claim. Querying that
   claim from child B exposed A's knowledge and reported usable support.
   Enforce the declared shared/child dependency direction consistently.
2. **P1 — Existing source IDs could be reassigned.** Capturing a different
   locator from another child with an existing source ID changed its locator
   and mixed source/evidence scopes. Preserve source identity and reject the
   request before mutation.
3. **P1 — Post-commit I/O failures lacked commit information.** An unwritable
   `.justification` directory produced raw `EACCES`, while durable history
   advanced. Wrap every projection failure after commit as
   `PROJECTION_FAILED`, with the committed revision and recovery instructions.
4. **P2 — Expired justification groups reported usable.** Group assessment
   ignored the justification's own applicability. Combine it with premise
   assessment so the response does not contradict itself.
5. **P2 — Exports lacked navigable/structured relationships.** Source links
   resolved one directory too shallow; ordinary justified claims omitted
   support groups and typed relationships from the extension. Preserve these
   records and render usable links.

The reviewer reproduced the first three findings using isolated builds of the
committed revision. All five findings were accepted for sequential Luna
regression fixes.

## Standards findings

No new hard documented-standard violation was found. The current ADR and
cycle-correction evidence records meaningful failures and passing runs; the
earlier foundation deviation remains separate.

Two test-quality findings were accepted: assert independently expected public
support states rather than ancestry alone, and compare the exact ancestry set
rather than only checking that expected IDs appear. The latter must reject
unrelated option/sibling leakage. Bounded AND/applicability checks cover the
new assessment semantics.

The reviewer also identified duplicate semantic traversal in the runtime and
serializer. Review-stage refactoring should give both a shared traversal or
reasoning representation while keeping Markdown rendering in the serializer.

## Correction validation

The five accepted findings now have public regression coverage and minimum
green implementations. Scope leakage and source-ID retargeting are rejected
before mutation; post-commit projection errors carry the committed revision;
expired justifications no longer mark their groups usable; and export output
contains relative source/premise links plus structured support, relationship
and provenance records. The pinned Node v24.21.0 build and complete suite pass
`47` tests with `0` failures. Independent Astra re-review of the corrected
range `b61fce8...0dc2ddd` closed the source-ID, projection-error, applicability
and link-format findings. It also confirmed that the transaction lock stays
held through projection publication and is released on success or failure.

The scope finding remains open in two narrower forms, both reproduced by the
Spec reviewer. A child-owned justification with entirely shared endpoints can
still appear in a sibling's `why` response. A shared document can also expose
an incoming child-owned relationship and its rationale during sibling export.
These require ownership checks on justification and relationship records,
alongside node visibility. Both corrections were assigned to Luna as public
regression cycles.

The Standards reviewer accepted the prior assertion and traversal fixes, and
requested one isolated coverage case: reuse the same source ID and locator
from the wrong child, so the owning-KB guard is exercised independently of the
locator guard. This is a test-quality correction; no new hard process
violation was found.

Final independent Spec and Standards re-reviews of
`0dc2ddd...8432583` found no remaining material/actionable findings. The
correction rejects mismatched justification ownership, filters scoped records
defensively, keeps incoming child relationships in their owning documents,
and preserves untouched manifest entries during scoped export. Public
regressions cover the reproduced failures; the same-locator wrong-KB case is
honestly recorded as immediately-green coverage. Luna reported all 50 tests,
typecheck and whitespace checks passing before the bounded commit. The next
slice is source-change maintenance.

## Scope re-review corrections

The two narrower P1 scope leaks now have public red-green regressions. A
justification must be owned by the same KB as its conclusion, and runtime
queries, support traversal and serialization exclude malformed
out-of-scope justifications. Child-owned relationships are serialized on the
owning child document and excluded from shared documents in sibling exports.

A related scoped-export P1 is also corrected: a scoped export carries forward
manifest ownership entries for generated files outside the selected KB, so a
later mutation can republish all generated documents without a false
`PROJECTION_FAILED`. The source-ID same-locator wrong-KB fixture passes
immediately against the existing guard and records no historical RED.

The three new focused regressions pass under Node v24.21.0, and the complete
suite now passes `50` tests with `0` failures. The request-schema worker's
separate validation experiment is intentionally outside this bounded scope.
