# Runtime TDD evidence

This note records the bounded runtime cycles completed by the implementation
agent. The domain, storage, provider and serializer foundations were written
before the first runtime behavior was exercised; they are foundation code and
are not retroactively claimed as TDD evidence. The public behavior tests use
temporary real project directories and the file-backed history implementation.

## Cycle 1: shared knowledge base discovery

Behavior: after `initializeProject(root)`, a public `knowledge_bases` operation
reports the shared knowledge base.

The deliberate red run used the public test before dispatch was implemented:

```text
Error [RuntimeError]: runtime operation is not implemented
code: INVALID_REQUEST
```

The smallest green implementation loads or creates durable revision `0`,
validates the optional scope, and returns the persisted project and shared KB
descriptor. The focused run passed the existing 13 bootstrap tests and this
behavior test (`14 passed, 0 failed` in the selected run).

## Cycle 2: child knowledge base creation and persistence

Behavior: `create_kb` creates a named child inheriting `shared`, commits one
history revision, and makes it visible to a later `knowledge_bases` call after
the same runtime is reopened.

The test was first run against the dispatcher's deliberate unsupported-operation
path and failed with the existing `INVALID_REQUEST` / `runtime operation is not
implemented` error. The minimum green implementation added validated child IDs,
parent lookup, safe `kb/<id>` directory creation, an append-only revision `1`,
expected-revision checking, and listing of the new child plus inherited shared
knowledge. The focused run passed all 15 tests (`15 passed, 0 failed`).

The currently implemented runtime operations are `knowledge_bases` and
`create_kb`. The remaining operation discriminants are intentionally typed and
documented for transport integration but still fail as unsupported until their
own red test is run. This keeps later work aligned with the one-behavior
red/green sequence in `docs/planning/tdd-plan.md`.

