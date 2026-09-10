import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";

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

test("runtime rejects a history directory symlink without writing outside the project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-runtime-history-link-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  try {
    await initializeProject(root);
    await symlink(outside, join(root, "justification-history"));

    await assert.rejects(
      executeOperation(root, { op: "knowledge_bases" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "HISTORY_CORRUPT");
        return true;
      }
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("export writes a readable current OKF projection and preserves unrelated KB files", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-export-"));
  try {
    await initializeProject(root);
    const keepPath = join(root, "kb", "shared", "keep.txt");
    await writeFile(keepPath, "unrelated project knowledge\n", "utf8");

    const exported = await executeOperation(root, { op: "export" });
    const data = exported.data as { historyIncluded: boolean; files: string[]; directory: string };
    assert.equal(data.historyIncluded, false);
    assert.ok(data.files.includes("kb/index.md"));
    assert.equal(await readFile(keepPath, "utf8"), "unrelated project knowledge\n");

    const index = await readFile(join(root, "kb", "index.md"), "utf8");
    assert.equal(index.startsWith("---\n"), true);
    const closing = index.indexOf("\n---\n", 4);
    assert.ok(closing > 4);
    const frontmatter = parseDocument(index.slice(4, closing)).toJSON() as { okf_version?: string };
    assert.equal(frontmatter.okf_version, "0.2");
    assert.equal(index.slice(closing, closing + 5), "\n---\n");

    const sharedIndex = await readFile(join(root, "kb", "shared", "index.md"), "utf8");
    assert.equal(sharedIndex.startsWith("---\n"), false);
    assert.equal(sharedIndex.startsWith("# Shared knowledge\n"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime rejects integrity-valid history with dangling domain references", async () => {
  const cases: Array<[string, (state: Record<string, unknown>) => void]> = [
    ["knowledge base parent", (state) => {
      const kbs = state.kbs as Record<string, unknown>;
      kbs.child = { id: "child", title: "Child", parent: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["source node", (state) => {
      const sources = state.sources as Record<string, unknown>;
      sources.source1 = { id: "source1", nodeId: "missing", kb: "shared", providerId: "file", locator: "note.md", availability: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["observation source", (state) => {
      const observations = state.observations as Record<string, unknown>;
      observations.observation1 = { id: "observation1", sourceId: "missing", providerId: "file", locator: "note.md", availability: "missing", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["justification premises", (state) => {
      const justifications = state.justifications as Record<string, unknown>;
      justifications.justification1 = { id: "justification1", kb: "shared", conclusion: "missing", groups: [{ id: "group1", premises: ["also-missing"] }], rationale: "fixture", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }],
    ["relationship endpoints", (state) => {
      const relationships = state.relationships as Record<string, unknown>;
      relationships.relationship1 = { id: "relationship1", kb: "shared", from: "missing", to: "also-missing", type: "depends_on", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    }]
  ];

  for (const [label, mutate] of cases) {
    const root = await mkdtemp(join(tmpdir(), "justification-runtime-domain-state-"));
    try {
      await initializeProject(root);
      await executeOperation(root, { op: "knowledge_bases" });
      await rewriteInitialRevision(root, mutate);
      await assert.rejects(
        executeOperation(root, { op: "knowledge_bases" }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "HISTORY_CORRUPT", label);
          return true;
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("create_kb rejects nested knowledge bases beyond the shared parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-parent-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "child", title: "Child", actor: "human:test" });
    await assert.rejects(
      executeOperation(root, { op: "create_kb", id: "grandchild", title: "Grandchild", parent: "child", actor: "human:test" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_SCOPE");
        return true;
      }
    );
    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const data = listed.data as { knowledgeBases: Array<{ id: string }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => kb.id), ["child", "shared"]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped KB lookup rejects inherited object keys and never widens visibility", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-kb-scope-"));
  try {
    await initializeProject(root);
    await assert.rejects(
      executeOperation(root, { op: "knowledge_bases", kb: "toString" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "NOT_FOUND");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create_kb rejects a stale expected revision without changing durable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-runtime-expected-revision-"));
  try {
    await initializeProject(root);
    await executeOperation(root, { op: "create_kb", id: "first", title: "First", actor: "human:test" });
    await assert.rejects(
      executeOperation(root, { op: "create_kb", id: "second", title: "Second", actor: "human:test", expectedRevision: 0 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "CONFLICT");
        return true;
      }
    );
    const listed = await executeOperation(root, { op: "knowledge_bases" });
    const data = listed.data as { knowledgeBases: Array<{ id: string }> };
    assert.deepEqual(data.knowledgeBases.map((kb) => kb.id), ["first", "shared"]);
    assert.equal(listed.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function rewriteInitialRevision(root: string, mutate: (state: Record<string, unknown>) => void): Promise<void> {
  const path = join(root, "justification-history", "000000000000.json");
  const revision = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const state = revision.state as Record<string, unknown>;
  mutate(state);
  const unsigned = { ...revision };
  delete unsigned.integrity;
  revision.integrity = createHash("sha256").update(canonicalJsonForTest(unsigned)).digest("hex");
  await writeFile(path, `${JSON.stringify(revision, null, 2)}\n`, "utf8");
}

function canonicalJsonForTest(value: unknown): string {
  const canonical = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonical);
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
    }
    return candidate;
  };
  return JSON.stringify(canonical(value));
}
