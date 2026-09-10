# File provider and client integration review

Two independent gpt-6-astra agents at medium reviewed the fixed range
`fd7af95...4b1b125` on 2026-09-10. This review covers provider containment and
bounded reads, the production legacy-client ADR test and demo/API alignment.
The concurrent runtime correction work was excluded.

The Spec reviewer reproduced one **P2**: a chain of two dangling symlinks could
hide an escaping target. If `first` points to `second`, and `second` points to
an outside nonexistent directory, capturing `first/missing.md` committed a
missing observation. This proves that an escaping locator was accepted; it
does not establish external content disclosure. The provider must resolve
unavailable target chains with cycle/depth protection before accepting their
containment. The finding was accepted for a Luna red/green correction.

The bounded handle read retains at most 4 MiB plus one sentinel byte, and fatal
UTF-8 decoding preserves a BOM so hashes remain tied to the exact bytes.
Neither reviewer found another material issue with those changes.

The Standards reviewer found no material process or test-quality issue. The
report distinguishes real containment/BOM reds from already-green oversized
behavior and inspection-based resource bounds. A minor evidence correction
was requested: the first fixture created a dangling directory symlink, while
the report described an existing outside directory. Its description and
coverage are being corrected without inventing another historical red.

The legacy MCP test verifies actual `2025-11-25` negotiation, exact ADR
ancestry/provenance and fixed-revision equivalence after a fresh server
restart. It lists two projects; cross-project node rejection and the second
project's unchanged state remain later integration checks. The demo and usage
changes match implemented record/justify result shapes. Full refresh/demo
completion remains pending.

Commit `b61fce8` adds recursive unresolved-target validation with active-link
cycle detection and a 40-link depth limit. The public two-link regression
first failed with a missing expected rejection, then passed with
`INVALID_LOCATOR` and unchanged revision zero. The original dangling fixture
remains, alongside explicitly labelled post-green coverage for an existing
outside directory with a missing descendant. Six provider tests and all 47
then-current tests passed. Independent Spec and Standards re-reviews of
`4b1b125...b61fce8` found no remaining material/actionable findings.
