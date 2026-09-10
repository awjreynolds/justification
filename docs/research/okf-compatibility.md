# Open Knowledge Format compatibility for the Justification MVP

Research date: 2026-09-10. Status: factual investigation complete; recommendations below require the persistence decision. No production implementation or interoperability certification was performed.

## Actionable finding

The brief matches **Google Cloud's Open Knowledge Format**, now maintained in **GoogleCloudPlatform/open-knowledge-format**. Target **OKF v0.2 at repository commit `ad30107c31c06aec8a7d5636e0d1058118604e6f`**, with a separately versioned Justification profile. Promise conformant readable exports and preservation of Justification semantics within that profile; do not promise arbitrary third-party graph round trips. The canonical specification is [SPEC.md at the inspected commit](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md).

## Identity, authority and maturity

Google introduced OKF v0.1 on 2026-06-12, describing a vendor-neutral Markdown/YAML interchange format and explicitly calling its producer and viewer proofs of concept. This is a strong match to the brief's portable compiled-knowledge requirement. [Google announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/).

A significant discovery: the frequently indexed `knowledge-catalog/okf` location is obsolete. Its own README identifies the new repository as canonical and says the old copy is frozen and unmaintained. Use that README only as migration evidence. [Frozen-copy notice](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/README.md).

The inspected canonical HEAD is dated 2026-08-21T20:08:36Z. `SPEC.md` still declares v0.2; its latest file-changing commit is `0b87c52c6ef999286c745e19998fdfcd03d5dbee`, dated 2026-08-21T19:31:43Z. [HEAD metadata](https://api.github.com/repos/GoogleCloudPlatform/open-knowledge-format/commits/ad30107c31c06aec8a7d5636e0d1058118604e6f), [specification history](https://api.github.com/repos/GoogleCloudPlatform/open-knowledge-format/commits?path=SPEC.md&per_page=3).

README and SPEC agree on **format v0.2**. The separately versioned Python package is `reference-agent` **0.1.0**; it must not be mistaken for format v0.1. No schema-named files or JSON files were present in the inspected repository tree, and no standalone machine-readable conformance schema was identified. The prose specification remains the compatibility authority. [Package metadata](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/pyproject.toml), [inspected tree](https://api.github.com/repos/GoogleCloudPlatform/open-knowledge-format/git/trees/ad30107c31c06aec8a7d5636e0d1058118604e6f?recursive=1).

The v0.2 migration moved content timestamps into `generated` and citations into `sources`; the later August timestamp change retained the v0.2 label. The latter also corrected YAML timestamp coercion in the reference implementation. **Inference:** a version string alone cannot reproduce the exact compatibility target; pin the source revision and review changes deliberately. [Migration commit](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/780fe9d30b5bbca8931256edf1d0290d6bda5462), [canonical timestamp change](https://github.com/GoogleCloudPlatform/open-knowledge-format/commit/3dc3029168d2f98e331feeb4ca05c9178973a9b9).

The canonical repository supplies Apache License 2.0. Record this as the upstream license; third-party sites' MIT labels do not establish the upstream license or rights in imported knowledge. [Pinned license](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/LICENSE.md).

The similarly named **Open Knowledge Foundation** publishes the **Open Definition 2.1**, which defines openness and licensing conditions, not this Markdown knowledge-bundle schema. No competing authoritative format matching the brief was identified. User intent cannot be proven from a name alone, but there is no remaining factual identity blocker. [Open Definition](https://opendefinition.org/od/2.1/en/).

## Compact normative boundary

The following summarizes the pinned [specification, §§2–12](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md):

| Surface | OKF contract |
|---|---|
| Documents | UTF-8 Markdown, YAML frontmatter, nonempty `type`; unknown types/keys tolerated. |
| Identity | Bundle-relative file path without `.md`. |
| Reserved files | `index.md` and `log.md` are not concepts; optional, with prescribed structures. Root index may declare `okf_version`. |
| Extensions | Additional keys allowed; unknown-key preservation is SHOULD, not MUST. |
| Links | Markdown links are untyped; `/` means bundle root; relative links supported; broken links tolerated. |
| Provenance | Each `sources` entry requires `resource`; optional `id` joins claim footnotes. Resource can be a scope description, not necessarily a resolvable URI. |
| Trust | `generated` identifies production; `verified` records checks. A verification mapping must normalize to a singleton list. |
| Lifecycle | `status`: draft/stable/deprecated, default stable. `stale_after` is an absolute instant. Timestamp fields require offset-bearing ISO datetimes. |
| History | Logs are dated prose, not a replay protocol. |

The canonical README supplies an agent, viewer and sample bundles, including Acme Retail exercising provenance, trust and freshness. These establish implementation examples, not complete preservation of Justification's reasoning model. [Reference tooling and samples](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/README.md).

## Implementation evidence and round-trip risks

The reference `OKFDocument` stores the full frontmatter mapping, dumps it with PyYAML, and normalizes body line breaks/spacing. Its loader disables implicit timestamp conversion; it still subclasses PyYAML's YAML 1.1 loader. Its validator checks presence/truthiness of `type`, rather than validating every field family. **Inference:** copying this implementation would not establish comprehensive schema validation, YAML 1.2 semantics, or byte-preserving editing. Comments, scalar presentation and whitespace need separate consideration. [Pinned parser](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/src/reference_agent/bundle/document.py).

The inspected round-trip test compares parsed frontmatter equality and stripped body equality. Other tests exercise minimal type-only documents, verification normalization, trust and staleness, including rejection of date-only staleness values. They do not demonstrate arbitrary bundle or extension round trips. This report inspected source/tests; it did not run their suite. [Pinned tests](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/tests/test_document.py).

## Recommended compatibility profile

These are design recommendations, not upstream requirements or settled architecture:

1. **Separate three claims:** OKF export conformance; permissive generic import; lossless semantic round trips of the explicitly versioned Justification profile. Report which contract each operation meets. Preserve unsupported input rather than interpreting it as verified knowledge.
2. **Own domain semantics in one extension namespace.** Define durable IDs, typed edges, scope/inheritance, provider revisions, contradiction objects, review issues and epistemic state there. Mirror essential relationships as readable prose/links so a generic viewer remains useful. Do not overload upstream `status` with `disputed` or `invalid`, or infer truth from a reviewer identity.
3. **Resolve identity independently of filenames.** Use immutable domain IDs plus an explicit ID-to-path mapping. Specify rename, promotion, relocation and cross-project behavior before committing to paths as internal keys.
4. **Choose the bundle boundary explicitly.** One project bundle could make child/shared links portable without special cross-bundle resolution; one bundle per KB requires an export closure or dependency convention. Neither is decided by the brief's directory sketch.
5. **Retain precise provenance.** Export human-readable sources, but require Justification evidence to identify provider, locator, revision and relevant excerpt/assertion. Preserve source citation IDs through reorderings. Treat unresolvable scope descriptions as incomplete evidence for automatic verification.
6. **Keep history reconstructible.** If a ledger is canonical, specify its export alongside compiled documents. A readable current projection alone must not be advertised as sufficient to reconstruct superseded reasoning or operational history.
7. **Define preservation precisely.** Preserve unknown metadata recursively and untouched body text; diagnose loss before rewriting unsupported YAML. Test edits through actual target consumers before promising preservation through them. Distinguish semantic equality from byte equality.

## Acceptance evidence and decisions still needed

Before claiming compatibility, create fixtures covering minimal/extended concepts; unknown metadata/types; reserved-file rules; verification mapping/list forms; timezone boundaries; footnote reorderings; relative/root/broken links; rename/promotion; and graph reconstruction after deleting indexes. Demonstrate readable generic consumption and profile export→import equivalence for the ADR scenario. Treat missing extension data as a detectable degradation, never a guessed dependency graph.

The persistence ticket must settle canonical ledger versus projection, KB/bundle boundary, ID and typed-edge encoding, profile version/migrations, manual-edit authority, and exact preservation guarantees. It should also decide whether legacy v0.1 import is needed. These are human/product decisions, not unresolved external facts. Attested-computation execution and broad third-party interoperability can remain outside the MVP compatibility promise.
