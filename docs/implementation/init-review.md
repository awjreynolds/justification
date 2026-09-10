# Init/discovery code review

Review model: **gpt-6-astra, medium**, in separate Standards and Spec contexts. Implementation model: **gpt-5.6-luna, max**. Initial reviewed diff: `a0e7ed22975a96351b38327c8168ee94096d5443...7148624bdc5f8e25def7607972314fed4b1cdd79`.

## Standards

One P2 process finding: repeatability, explicit scope, CLI discovery and invalid-request regression checks passed when first added, departing from the requested strict red–green sequence. The record disclosed this. Keep the useful tests and the disclosure; require an observed failure before implementing each newly missing behavior. Recreating historical failures by removing working code would not repair the process.

No material code-smell finding. The reviewer confirmed that tests use public runtime/process interfaces, realistic temporary project data and independent expected values. The first snapshot cannot independently prove past test order; the evidence is recorded in [the implementation note](init-tdd.md).

## Spec

Two reproducible P2 findings:

- A whitespace-only project directory name produced metadata that initialization accepted but discovery rejected. Successful initialization must produce reopenable metadata.
- A dangling `justification.json` symlink was treated as missing metadata; initialization then changed project structure before failing. An existing broken descriptor must be rejected explicitly before initialization changes the structure.

Both were sent back to Luna for one failing public-interface test followed by a minimal fix per behavior. The remaining inspected behavior matched the bounded [first-slice contract](../planning/first-slice.md).

## Follow-up

Fix commit: `52cf91ee7c04fb27ec0f5c775f0d49292251a4a3`. Both Astra-medium follow-ups passed. Spec review independently reproduced the corrected whitespace-name and dangling-link cases, including unchanged link/KB structure after rejection and correct handling of absent descriptors. Standards review found no new actionable violation or material code smell; the historical test-sequencing deviation remains explicitly recorded.

Packaging now declares Node `>=24.21.0`, uses a Node filesystem operation for the executable bit, and runs native TypeScript tests without the redundant experimental flag. Luna reported successful typechecking, build, all **13 tests**, and packaging verification on Node **24.21.0**.

A separate final check packed the built project, installed that tarball into a fresh temporary consumer with install scripts disabled, and invoked its installed `justification` executable. Initialization and discovery returned the same persisted project identity and shared KB; engine metadata was present. This validates the packaged CLI on macOS arm64 with Node 24.21.0, not every operating system or future Node release. The temporary installation and fixtures were removed.
