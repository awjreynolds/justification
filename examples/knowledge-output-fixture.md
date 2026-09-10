# General knowledge-output fixture

`knowledge-output-demo.mjs` is a deterministic fictional research workflow.
It captures a product survey and independent field notes, records one claim
from each retained observation with an explicit support group, and writes a
research brief whose artifact basis names the survey claim directly. The
independent notes claim remains a separate reusable branch. The brief also
carries an open question as a stated limitation; no decision record is needed
to create this output.

The survey file then changes while the independent notes stay unchanged.
`refresh` retains the new survey observation and opens review for the old
survey evidence, its claim and the brief. `impact` checks the exact paths and
the independent notes source remains outside that affected set. A current
`why` query reports the brief as pending reassessment, while a historical
`why` query at the brief's recording revision preserves its original usable
basis and the original survey observation.
