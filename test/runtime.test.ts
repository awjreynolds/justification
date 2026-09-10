import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

test("knowledge_bases discovers the shared KB after project initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-bootstrap-"));
  try {
    await initializeProject(root);
    const response = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(response.data instanceof Object, true);
    const data = response.data as { knowledgeBases: Array<{ id: string; parent: string | null }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => ({ id: kb.id, parent: kb.parent })), [{ id: "shared", parent: null }]);
    assert.equal(response.revision, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create_kb creates a persistent child inheriting shared knowledge", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-"));
  try {
    await initializeProject(root);
    const created = await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:test"
    });
    assert.equal(created.revision, 1);
    const createdData = created.data as { knowledgeBase: { id: string; parent: string | null; title: string } };
    assert.equal(createdData.knowledgeBase.id, "adr");
    assert.equal(createdData.knowledgeBase.parent, "shared");
    assert.equal(createdData.knowledgeBase.title, "Architecture decision");

    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const listedData = listed.data as { knowledgeBases: Array<{ id: string; parent: string | null }> };
    assert.deepEqual(listedData.knowledgeBases.map((kb) => ({ id: kb.id, parent: kb.parent })), [
      { id: "adr", parent: "shared" },
      { id: "shared", parent: null }
    ]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
