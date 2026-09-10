# First TDD slice: initialise and discover a project

The user confirmed the runtime, CLI and MCP test seams and the proposed first behavior on 2026-09-10, with the additional requirement to verify current methods. This authorizes this bounded first implementation; the broader Wayfinder domain and MCP decisions remain open.

## Contract for this slice

- A public runtime operation initialises a caller-selected project directory and creates `kb/shared`.
- A public discovery operation inspects only explicitly supplied project roots. It returns a stable project identity, display name, canonical root and shared KB descriptor. Reopening the project reproduces its identity without requiring the previous runtime instance.
- Keep a small readable, versioned project descriptor in `justification.json`. It is bootstrap project metadata, not the eventual knowledge/evidence format or a claim of full OKF support. Shared is identified by `shared` and located at `kb/shared`.
- Initialization is repeatable without overwriting existing project or KB content. Reject malformed or unsupported existing metadata explicitly; a directory without a descriptor is simply uninitialised. Validate existing structure instead of silently accepting a missing/broken shared KB.
- Provide `justification init [directory]` and `justification projects <directory>...` as thin CLI operations over this runtime. Directory omission for init means the current directory; discovery always has explicit roots. Return useful JSON and nonzero status for invalid requests/failures.
- No source retrieval, graph schema, semantic interpreter or MCP implementation belongs in this slice. The approved MCP seam will be exercised after the client compatibility task.

The first test observes initialization through runtime discovery. Add subsequent tests one at a time only for the repeatability, persistence, explicit scope, malformed-state handling and CLI behavior above. Each test must first fail for its missing behavior and then pass after the smallest implementation change.

## Initial toolchain choice

Use TypeScript with Node's built-in test runner, avoiding a separate test framework for this small file-based runtime. Node 24 is the active LTS line; current production guidance recommends an LTS release. TypeScript's official site identifies major 7 as current, and the npm registry returned stable `typescript@7.0.2` on 2026-09-10. Pin development dependencies and commit the lockfile; validate actual installation and typechecking rather than assuming compatibility.

Sources checked 2026-09-10: [Node release status](https://nodejs.org/en/about/previous-releases), [Node 24 test runner](https://nodejs.org/docs/latest-v24.x/api/test.html), [TypeScript installation guidance](https://www.typescriptlang.org/download/), npm registry queries `npm view typescript version dist-tags --json` and `npm view @types/node@24 version --json`.

This is a reversible bootstrap choice, not a completed decision about the full runtime/MCP distribution. Prefer the current Node 24 patch for validation; record any difference between advertised versions and the available execution environment.

The official release index identifies Node **24.21.0**, released 2026-09-07, as the current Node 24 patch. Its macOS arm64 archive was downloaded into a temporary toolchain and matched the official SHA-256 digest `bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`. This leaves the user's global Node installation unchanged. Sources: [official release index](https://nodejs.org/dist/index.json), [versioned checksums](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt). Actual build/test results belong in `docs/implementation/init-tdd.md`.
