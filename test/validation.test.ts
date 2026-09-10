import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

test("runtime rejects an unsupported top-level request field without advancing revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-top-level-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "knowledge_bases",
        unsupportedField: "must be rejected"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /unsupportedField/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects caller-supplied provenance fields in record.fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-fields-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: "Caller supplied provenance must not be accepted",
        fields: { sourceId: "forged-source" },
        actor: "validation:test"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /sourceId/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects basis on ordinary records with guidance to use justify", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-basis-"));

  try {
    await initializeProject(root);
    const premise = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Existing support premise",
      actor: "validation:test"
    });
    const premiseId = (premise.data as { node: { id: string } }).node.id;
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: "Basis belongs in justify",
        basis: [premiseId],
        actor: "validation:test"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /use justify/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects an impossible calendar date in applicability", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-calendar-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: "Impossible calendar dates must be rejected",
        applicability: { validFrom: "2026-02-30T00:00:00Z" },
        actor: "validation:test"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /validFrom|calendar date/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects an impossible calendar date with a lowercase separator", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-calendar-lowercase-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: "Lowercase timestamp separators must not bypass calendar validation",
        applicability: { validFrom: "2026-02-30t00:00:00Z" },
        actor: "validation:test"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /validFrom|calendar date/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects inherited operation names as invalid requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-inherited-operation-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    for (const op of ["constructor", "__proto__"]) {
      await assert.rejects(
        executeOperation(root, { op } as never),
        (error: unknown) => {
          const candidate = error as { code?: string; message?: string };
          assert.equal(candidate.code, "INVALID_REQUEST");
          assert.equal(candidate.message, `unsupported runtime operation: ${op}`);
          return true;
        }
      );

      const after = await executeOperation(root, { op: "knowledge_bases" });
      assert.equal(after.revision, before.revision);
      assert.deepEqual(after.data, before.data);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects source fields on an ordinary claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-kind-fields-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "record",
        kb: "shared",
        kind: "claim",
        title: "Ordinary claims cannot fabricate source provenance",
        fields: { locator: "nonexistent.md", digest: "not-a-digest" },
        actor: "validation:test"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /locator|digest|source/);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects mixed-case knowledge-base identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-validation-kb-case-"));

  try {
    await initializeProject(root);
    const before = await executeOperation(root, { op: "knowledge_bases" });

    await assert.rejects(
      executeOperation(root, {
        op: "create_kb",
        id: "Shared",
        title: "Mixed-case KB must be rejected",
        actor: "validation:test",
        at: "2026-01-01T00:00:00Z"
      } as never),
      (error: unknown) => {
        const candidate = error as { code?: string; message?: string };
        assert.equal(candidate.code, "INVALID_REQUEST");
        assert.match(candidate.message ?? "", /id/i);
        assert.match(candidate.message ?? "", /lowercase|lower-case|lower case/i);
        return true;
      }
    );

    const after = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.data, before.data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
