# Source maintenance review

The Astra-medium Spec review inspected committed `322f1f9...cf4c697` on
2026-09-10. The first public source-change behavior had an observed unsupported
`refresh` RED before implementation, followed by 21 passing runtime tests.
Schema and recovery work was outside the review range.

The reviewer reproduced three material findings through public operations:

1. Refreshing a shared source with `kb: "a"` returned reviews belonging to
   child B. Durable review propagation must cover every affected child, but
   returned records must obey the requested visibility. Changed recapture needs
   the same response filtering.
2. With a claim supported by retained content A, the sequence A → B → A → C
   restored the original claim's usable support and then made it pending again
   without creating a new review. Propagation considered only the immediately
   preceding observation, missing older retained evidence still used by claims.
3. Losing access to a captured source's directory caused resolution to throw
   before a durable source transition. The source remained recorded as present.
   Operational access failures must produce unavailable/denied transitions;
   invalid escaping locators must continue to be rejected.

Commit `ac13cb1` addresses these findings through three separate public
red–green cycles. The Spec re-review closed all three original findings, then
reproduced two additional declared-dependency omissions:

- An artifact with an independently accepted basis and an explicit
  `depends_on` link to retained evidence appeared in `impact`, but source
  refresh created no review for it or that old evidence. Review propagation
  must not require direct membership in a justification.
- An artifact depending directly on the source graph node was absent from
  source `impact` and received no review. Traversal must include direct source
  dependencies as well as retained evidence, with concrete paths.

Commit `05f595e` corrects both dependency findings. Each regression had an
observed public RED before its minimum GREEN; exact review/impact sets and
paths also verify that freshly matching evidence is not reviewed. Both Astra
review axes returned no remaining actionable findings for the final source
slice. Parent verification
of the combined committed implementation passed typecheck and all 70 tests
under Node 24.21.0.

The Standards review found no new hard violations or material code smells. It
requested exact review counts and uniqueness of `(nodeId, triggerId)` in the
maintenance test, because converting IDs to a set could conceal duplicates in
the first refresh. The final test includes exact counts, unique node/trigger
pairs and converging support routes; the Standards re-review closed this
coverage finding. Its immediately passing assertions are recorded as
verification rather than historical RED. The later combined suite, including
the real MCP maintenance lifecycle, passed all 74 tests before the next query
slice introduced its intentional RED.
