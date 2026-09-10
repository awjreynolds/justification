# File provider correction evidence

Date: 2026-09-10

Implementation assignment: **gpt-5.6-luna, max**. The provider slice is
limited to path containment for missing targets and bounded file capture. It
does not add refresh operations or change the runtime provider API.

## Symlink containment cycle

The first public regression used `executeOperation` with an initialized
temporary project. It created an existing directory outside the project,
linked `project/external` to it, and captured `external/missing.md`. Before
the provider change, the test produced this observed RED result:

```text
✖ capture_source rejects a missing target beneath a symlink that escapes the project
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
tests 1
pass 0
fail 1
```

The minimum correction validates the nearest existing canonical ancestor
before accepting an `ENOENT`/`ENOTDIR` result. It also walks existing path
prefixes with `lstat`, checks dangling symlink targets with `readlink`, and
rejects canonical paths inside managed state. `fetch` re-resolves the locator
before opening it, so a path retargeted between resolve and fetch fails closed
unless the originally resolved file has simply disappeared.

The same real-file test file then passed four checks:

```text
✔ capture_source rejects a missing target beneath a symlink that escapes the project
✔ capture_source follows an internal symlink and preserves the captured bytes digest
✔ capture_source rejects a missing target beneath a symlink into managed state
✔ capture_source keeps oversized-file behavior bounded and unavailable
tests 4
pass 4
fail 0
```

The internal-link assertion computes the expected SHA-256 over the UTF-8 bytes
independently with `createHash`; it does not reuse provider code.

The byte-identity fixture includes a UTF-8 BOM. Adding assertions that the
captured text retains the BOM and that `digest` and `providerRevision` equal
the independently computed byte hash exposed a second real RED result: the
provider returned text without the BOM. Setting `TextDecoder`'s `ignoreBOM`
option to `true` was the minimum correction. The observed assertion was:

```text
actual:   "internal source\n"
expected: "﻿internal source\n"
```

The four provider tests then returned GREEN, including equal text and byte
identities for that fixture.

## Bounded capture correction

The previous provider already returned `unavailable` for content larger than
4 MiB, but it did so only after `readFile` had loaded the whole file. That
existing public result did not have a missing behavioral RED to recreate. The
oversized-file test is therefore a behavior guard, while the resource-bound
claim is established by implementation inspection: `fetch` opens a real file
handle, checks `fstat().size` before reading, reads at most 4 MiB plus one byte
in 64 KiB chunks, and checks the handle size again before decoding. The
bounded bytes are then decoded with fatal UTF-8 validation and hashed both as
text and as the exact captured bytes.

## Verification

The provider seam passed:

```text
node --test test/provider.test.ts
tests 4
pass 4
fail 0
```

The repository type check and full test command also passed on the same
working tree:

```text
npm run typecheck
npm test
tests 44
pass 44
fail 0
```

There is no deterministic concurrent retarget test in this slice; the
re-resolution check covers the obvious resolve/fetch retarget case without
introducing timing-dependent infrastructure.
