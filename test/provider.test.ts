import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ProviderError } from "../src/provider.ts";
import { executeOperation, initializeProject } from "../src/index.ts";

test("capture_source rejects a missing target beneath a symlink that escapes the project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-provider-escape-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");

  try {
    await initializeProject(root);
    await symlink(outside, join(root, "external"));

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        locator: "external/missing.md",
        actor: "test:provider"
      }),
      (error: unknown) => {
        assert.equal(error instanceof ProviderError, true);
        assert.equal((error as ProviderError).code, "INVALID_LOCATOR");
        return true;
      }
    );

    const status = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(status.revision, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("capture_source rejects a missing target beneath an existing escaping directory symlink", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-provider-existing-escape-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");

  try {
    await initializeProject(root);
    await mkdir(outside);
    await symlink(outside, join(root, "external"));

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        locator: "external/missing.md",
        actor: "test:provider"
      }),
      (error: unknown) => {
        assert.equal(error instanceof ProviderError, true);
        assert.equal((error as ProviderError).code, "INVALID_LOCATOR");
        return true;
      }
    );

    const status = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(status.revision, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("capture_source rejects a missing target through chained dangling escaping symlinks", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-provider-chain-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");

  try {
    await initializeProject(root);
    await symlink(outside, join(root, "second"));
    await symlink("second", join(root, "first"));

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        locator: "first/missing.md",
        actor: "test:provider"
      }),
      (error: unknown) => {
        assert.equal(error instanceof ProviderError, true);
        assert.equal((error as ProviderError).code, "INVALID_LOCATOR");
        return true;
      }
    );

    const status = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(status.revision, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("capture_source follows an internal symlink and preserves the captured bytes digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-provider-internal-"));

  try {
    await initializeProject(root);
    await mkdir(join(root, "sources"));
    const sourceText = "\uFEFFinternal source\n";
    await writeFile(join(root, "sources", "note.md"), sourceText, "utf8");
    await symlink(join("sources", "note.md"), join(root, "current-note.md"));

    const captured = await executeOperation(root, {
      op: "capture_source",
      locator: "current-note.md",
      actor: "test:provider"
    });
    const data = captured.data as {
      observation: { observedText: string; observedBytesDigest: string; providerRevision: string; digest: string; availability: string };
    };

    assert.equal(data.observation.availability, "present");
    assert.equal(data.observation.observedText, sourceText);
    const expectedBytesDigest = createHash("sha256").update(Buffer.from(sourceText, "utf8")).digest("hex");
    assert.equal(data.observation.observedBytesDigest, expectedBytesDigest);
    assert.equal(data.observation.digest, expectedBytesDigest);
    assert.equal(data.observation.providerRevision, `sha256:${expectedBytesDigest}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture_source rejects a missing target beneath a symlink into managed state", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-provider-managed-"));

  try {
    await initializeProject(root);
    await symlink(join(root, "kb"), join(root, "managed-link"));

    await assert.rejects(
      executeOperation(root, {
        op: "capture_source",
        locator: "managed-link/missing.md",
        actor: "test:provider"
      }),
      (error: unknown) => {
        assert.equal(error instanceof ProviderError, true);
        assert.equal((error as ProviderError).code, "INVALID_LOCATOR");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture_source keeps oversized-file behavior bounded and unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-provider-large-"));

  try {
    await initializeProject(root);
    await writeFile(join(root, "large.txt"), Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));

    const captured = await executeOperation(root, {
      op: "capture_source",
      locator: "large.txt",
      actor: "test:provider"
    });
    const data = captured.data as {
      observation: { availability: string; observedText?: string; diagnostics?: string };
      evidence: unknown;
    };

    assert.equal(data.observation.availability, "unavailable");
    assert.equal(data.observation.observedText, undefined);
    assert.match(data.observation.diagnostics ?? "", /source exceeds 4194304 bytes/);
    assert.equal(data.evidence, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
