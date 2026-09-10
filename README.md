# Justification

Justification is a local-first, vendor-neutral context and justification graph for agentic work. It aims to make consequential project knowledge traceable to its sources and show which decisions and artifacts may need review when their support changes.

The first runtime slice initializes local projects and discovers their shared knowledge bases. Graph reasoning, source refresh and MCP support remain planned.

Use the Node version in `.nvmrc`, then run from this checkout:

```sh
npm ci
npm run typecheck
npm test

node dist/cli.js init /path/to/project
node dist/cli.js projects /path/to/project
```

Initialization creates a readable `justification.json` project descriptor and `kb/shared`. Repeating initialization preserves existing identity and knowledge. Discovery inspects the project roots you supply; both commands return JSON, with errors on stderr and a nonzero exit status.

The runtime exports `initializeProject(root)` and `discoverProjects(roots)` from `dist/index.js`. The bootstrap descriptor is separate from the eventual knowledge format; this slice does not yet provide OKF export.

- [Brief review and candidate MVP route](docs/planning/brief-review.md)
- [Wayfinder decision map](.scratch/justification-mvp/map.md)
- [Domain language](CONTEXT.md)
- [Independent planning review](docs/planning/plan-review.md)
- [Confirmed TDD workflow](docs/planning/tdd-plan.md)
- [Implementation and verification evidence](docs/implementation/init-tdd.md)
- [Current engineering methods and recheck rules](docs/research/current-engineering-methods.md)

Licensed under the [MIT License](LICENSE).
