# Fictional ADR fixture: checkout cache

This worked fixture is deliberately fictional. It gives the runnable example a
small, deterministic graph without implying that the benchmark or the choice is
real production advice.

The project is **Acme Checkout**, and the child knowledge base is
`checkout-cache`. A project-wide constraint is shared with the child KB:

> Checkout reads must stay below 150 ms at p95, including a cache miss.

The team considers three options:

1. **Redis** — a managed Redis-compatible cache with replication.
2. **SQLite** — a local SQLite database on the application host.
3. **Memory** — an in-process LRU cache.

The file-provider source is `evidence/cache-benchmark.md`. Its captured
observation says that the fictional benchmark measured the following p95 miss
latencies:

| Option | p95 miss latency | Survives process restart |
| --- | ---: | --- |
| Redis | 82 ms | yes |
| SQLite | 191 ms | yes |
| Memory | 41 ms | no |

From that observation, the fixture records the attributed claim that Redis is
the only option in this set that satisfies both the latency constraint and the
restart requirement. The decision selects Redis and records the constraint,
claim and selected option as its original basis. The ADR artifact references
the decision and records the digest of the whole file, so its explanation can
be followed back to the retained observation and the source locator.

The example then changes the benchmark file so that Redis measures 171 ms. A
refresh retains the old observation, records a new observation and change, and
opens review for the claim, decision and ADR artifact through their declared
dependencies. The historical `why` query at the decision's acceptance
revision still reports the original 82 ms explanation. A second refresh with
the same bytes is a no-op. A cold rebuild after removing the disposable
`.justification/` directory produces the same current explanation and review
state.

The second project in the example contains its own unrelated source and graph;
the refresh is scoped to Acme Checkout, so the second project remains at its
initial revision.
