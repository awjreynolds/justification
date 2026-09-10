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

Correction validation and re-review are pending.
