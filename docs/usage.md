# Runtime and transport usage

Justification has one semantic entry point. The TypeScript runtime, JSON CLI
and MCP server all validate and execute the same request union, so a result does
not depend on the transport used to reach it. The complete request types are in
[runtime-api.md](implementation/runtime-api.md).

## Build and initialize

The project requires Node `24.21.0`, recorded in [.nvmrc](../.nvmrc).

```sh
npm ci
npm run build
npm run typecheck
npm test
```

Initialize each project root explicitly. Initialization creates or reopens the
project descriptor and `kb/shared`; the project ID is persisted in
`justification.json`.

```sh
justification init ./checkout
justification init ./search
justification projects ./checkout ./search
```

Discovery is scoped to the roots supplied to that call. It does not scan a
parent directory for projects.

## Use the public runtime

Import the built package after `npm run build`:

```js
import { executeOperation, initializeProject } from "justification";

const project = await initializeProject("./checkout");
const shared = await executeOperation(project.root, {
  op: "knowledge_bases"
});
console.log(shared.data.knowledgeBases);

await executeOperation(project.root, {
  op: "create_kb",
  id: "checkout-cache",
  title: "Checkout cache experiment",
  actor: "alex"
});

const requirementNode = await executeOperation(project.root, {
  op: "record",
  kb: "shared",
  kind: "requirement",
  title: "Checkout p95 latency constraint",
  body: "Checkout reads stay below 150 ms at p95.",
  fields: { accepted: true },
  actor: "alex"
});

const capture = await executeOperation(project.root, {
  op: "capture_source",
  kb: "checkout-cache",
  locator: "evidence/cache-benchmark.md",
  actor: "alex"
});

const claim = await executeOperation(project.root, {
  op: "record",
  kb: "checkout-cache",
  kind: "claim",
  title: "Redis meets the latency requirement",
  body: "The retained benchmark supports this claim.",
  actor: "alex"
});

await executeOperation(project.root, {
  op: "justify",
  conclusion: claim.data.node.id,
  groups: [[requirementNode.data.node.id, capture.data.evidence.id]],
  rationale: "The accepted requirement and retained observation jointly support the claim.",
  kb: "checkout-cache",
  actor: "alex"
});
console.log(claim.revision, claim.data);
```

Every successful response has `{ revision, data }`. Mutation requests require
an actor. IDs are returned by the operation that creates a node and should be
passed to subsequent operations; do not invent IDs or use titles as graph
references. `why`, `impact`, `trace`, `context`, `search`, `conflicts`,
`changed` and `audit` are read operations. `why` accepts a committed
`revision` and an explicit `evaluationTime` for reproducible historical output.

The general knowledge workflow is:

1. Create a child KB with `create_kb`.
2. Capture a file with `capture_source`; inspect its stable source identity and
   retained observation with `inspect_source` and `evidence`.
3. Record claims, requirements and options with `record`; requirements and
   assumptions must set `fields.accepted: true` before they can ground support.
   Attach claim or other current support with `justify`, putting jointly
   required premises in one group and alternatives in separate groups.
4. When a choice is made, record a decision with its basis. When creating a
   knowledge output, record an artifact with an explicit `basis` or `basisGroups`.
   Decisions use
   `fields.consideredOptions`, `fields.selectedOption` and
   `fields.rationale`; artifacts use `fields.locator` and `fields.digest`.
5. Explain a node with `why`, inspect downstream dependencies with `impact` or
   `trace`, and run `audit` before publishing a consequential result.
6. After a source file changes, call `refresh` with an actor. Inspect the
   returned changes and reviews, then reassess the affected interpretation.

Support groups are declarations of the argument supplied by a person or agent.
The runtime checks that their premises are available and applicable; it does not
infer truth from arbitrary prose or call a language model. A changed or missing
source makes dependent support pending and can open review; it does not mark a
claim false. Multiple groups are alternatives, so a surviving alternative can
  remain usable while the original basis is reviewed.

## Create knowledge outputs

An agent can use the accumulated knowledge to write a research brief, report,
plan, proposal or other output with the appropriate authoring tools. Record
that output as an `artifact`, referencing the claims, requirements or decisions
that support it. A research synthesis may cite claims directly; it does not
need an artificial decision record. The output's file locator and captured
digest identify the version whose basis was recorded.

The readable `kb/` projection is also compiled knowledge in its own right.
It preserves attributed knowledge and reasoning for reuse across sessions and
outputs. The runtime manages these relationships and their maintenance; the
person or agent supplies interpretation and writes the output. The first
example uses an ADR to exercise these general operations.

## CLI JSON transport

The CLI writes one JSON result to stdout. Errors are JSON objects on stderr and
return a nonzero status. A request can be read from a file or stdin:

```sh
justification run ./checkout request.json
cat request.json | justification run ./checkout -
```

For example, `request.json` can contain:

```json
{
  "op": "search",
  "query": "latency",
  "kb": "checkout-cache",
  "budget": 20
}
```

Use the `init` and `projects` commands for bootstrap and discovery. Use `run`
for all graph operations; it keeps the CLI surface aligned with the runtime.

## MCP stdio server

Start one server with every project root it may serve:

```sh
justification mcp ./checkout ./search
```

The server discovers those roots at launch and routes requests using persisted
project IDs. Configure the MCP client to launch this command as a local stdio
server. MCP stdout is reserved for protocol traffic; diagnostics belong on
stderr. The server exposes operation schemas and structured results/errors for
the same mutation and query operations available through `run`.

The server intentionally does not accept arbitrary filesystem roots in a tool
call. Add a root to the launch configuration when a project should become
available, then restart the server. The exact protocol and SDK compatibility
baseline is recorded in
[mcp-provider-contracts.md](research/mcp-provider-contracts.md) and the
implementation evidence under `docs/implementation/`.

## Scope and projection

`shared` is visible to each child KB. A child sees itself and `shared`, never a
sibling. Visibility does not broaden a node's subject, version or time
applicability. Cross-project graph references are rejected. Use `promote` for an
explicit shared-scope move after checking upstream dependencies.

`export` writes the current readable OKF projection. It is a current reading
view; the numbered files under `justification-history/` are required to explain
earlier revisions. Generated projection files are runtime-owned. Edit native
history through operations, and use the recovery procedure when a generated
projection drifts.

The [ADR proof](../examples/adr-demo.mjs) is the shortest end-to-end example.
