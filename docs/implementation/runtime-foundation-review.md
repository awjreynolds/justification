# Runtime foundation review

Reviewed independently by two gpt-6-astra agents at medium on 2026-09-10. Fixed comparison: `git diff 2b1f88b...edb73aa`. The reviewed implementation scope is shared/child KB operations and the storage/provider/serializer foundations; later operation placeholders are explicitly excluded as missing-feature findings.

## Standards

Two documented-standard findings:

- **P2 — Foundation code preceded the required behavioral TDD cycles.** The implementation note discloses this honestly. It is a process deviation, not an exception granted by AGENTS.md. It cannot be repaired by claiming retrospective reds. Subsequent implementation is restricted to observed behavioral failures and minimum passing changes, and the existing foundation guarantees require independent verification.
- **P2 — Dependency adoption evidence was absent from the reviewed commit.** The lockfile pins versions, but the SDK/Zod/YAML version and compatibility evidence was not yet committed with that snapshot. The parallel MCP experiment and the dated dependency baseline address the documentation gap; they must be assessed as later evidence.

The public tests use realistic temporary projects and independent expected values. The reviewer identified coverage gaps for scoped listing, expected revision rejection, corruption and concurrency, and requested reproducible commands in the TDD record. No additional actionable smell judgments were reported.

## Spec

Three actionable findings:

- **P1 — History directory symlink escape.** An isolated public-operation reproduction caused both initial and child-KB revision files to be written outside the selected project through a symlinked `justification-history/`. Managed history paths must be checked before reads and writes.
- **P1 — Invalid generated frontmatter.** The serializer trimmed the YAML's final newline and concatenated the closing delimiter onto the last value. Published documents must place that delimiter on its own line and be tested using an independent parser.
- **P2 — Incomplete domain-reference validation.** The history loader checked object shapes but not referenced source/node/KB identities. Digest integrity does not establish semantic validity. Load and commit must validate domain references.

All five findings were accepted. Luna was assigned sequential regression fixes and the smallest public export behavior needed to verify compiled Markdown.

## Repair and re-review

At `65b1dab`, the history guards, delimiter/KB-index corrections and common reference validator were in place. Independent execution passed 28 tests, build and typecheck. Re-review confirmed the fixes, while finding a first-export collision that could overwrite human-authored `kb/shared/index.md`, plus two weak fixtures: export had only tested the root index, and the missing-premise fixture also had a missing conclusion.

At `f102b89`, publication preflights every generated destination before writing and rejects unknown existing files. The new regression observed the overwrite before the fix, then verified preserved human bytes and no partial publication. Export now exercises a retained node through an independent frontmatter parser. Reference fixtures isolate the intended invalid edge with valid neighboring data.

The final bounded Spec re-review through `f102b89` reported no remaining findings in these corrections and approved moving to the next vertical slice. The Standards re-review found no new hard violations, accepted the committed dependency evidence and required the fixture improvements above. The original pre-test foundation deviation remains acknowledged; later evidence does not rewrite that history.

Full reasoning projections, cache-loss drift handling and additional graph operations are subsequent slices, not claims of this foundation review.
