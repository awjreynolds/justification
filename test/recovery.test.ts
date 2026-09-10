import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { executeOperation, initializeProject } from "../src/index.ts";

const execFile = promisify(execFileCallback);

type ProjectionSnapshot = {
  readonly manifest: { readonly format: string; readonly version: number; readonly files: Record<string, string> };
  readonly files: Record<string, string>;
};

async function readProjection(root: string): Promise<ProjectionSnapshot> {
  const manifest = JSON.parse(await readFile(join(root, ".justification", "projection-manifest.json"), "utf8")) as ProjectionSnapshot["manifest"];
  const files: Record<string, string> = {};
  for (const path of Object.keys(manifest.files).sort()) files[path] = await readFile(join(root, path), "utf8");
  return { manifest, files };
}

async function isGitIgnored(root: string, relativePath: string): Promise<boolean> {
  try {
    await execFile("git", ["check-ignore", "--quiet", "--", relativePath], { cwd: root });
    return true;
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === 1) return false;
    throw error;
  }
}

test("rebuild restores disposable state and native copies without changing semantic explanations", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-recovery-"));
  const root = join(parent, "project");
  const restored = join(parent, "restored");
  await mkdir(root, { recursive: true });
  try {
    await initializeProject(root);
    const sourceLocator = "constraints.md";
    const sourceText = "Constraint C1: the service must run without network access.\n";
    await writeFile(join(root, sourceLocator), sourceText, "utf8");

    const captured = await executeOperation(root, {
      op: "capture_source",
      locator: sourceLocator,
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });
    const capturedData = captured.data as {
      readonly evidence: { readonly id: string };
      readonly source: { readonly id: string };
    };

    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The service can run offline",
      body: "The retained constraint supports offline operation.",
      actor: "human:recovery",
      at: "2026-09-10T09:01:00Z"
    });
    const claimId = (claim.data as { readonly node: { readonly id: string } }).node.id;

    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: claimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained source observation states the offline constraint.",
      actor: "human:recovery",
      at: "2026-09-10T09:02:00Z"
    });

    const decision = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "decision",
      title: "Choose offline execution",
      body: "Choose an implementation that runs without network access.",
      basis: [claimId],
      fields: { rationale: "The claim is grounded in the retained source observation." },
      actor: "human:recovery",
      at: "2026-09-10T09:03:00Z"
    });
    const decisionId = (decision.data as { readonly node: { readonly id: string } }).node.id;
    const semanticRevision = decision.revision;

    const unrelatedPath = join(root, "kb", "shared", "unrelated.md");
    const unrelatedText = "This human-owned KB note must survive recovery.\n";
    await writeFile(unrelatedPath, unrelatedText, "utf8");

    const evaluationTime = "2026-09-10T12:00:00Z";
    const beforeWhy = await executeOperation(root, {
      op: "why",
      nodeId: decisionId,
      kb: "shared",
      revision: semanticRevision,
      evaluationTime
    });
    const beforeProjection = await readProjection(root);

    await mkdir(restored, { recursive: true });
    await mkdir(join(restored, "kb", "shared"), { recursive: true });
    await cp(join(root, "justification.json"), join(restored, "justification.json"));
    await cp(join(root, "justification-history"), join(restored, "justification-history"), { recursive: true });
    await cp(join(root, sourceLocator), join(restored, sourceLocator));
    await cp(unrelatedPath, join(restored, "kb", "shared", "unrelated.md"));
    await initializeProject(restored);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    const rebuilt = await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: evaluationTime });
    assert.equal(rebuilt.revision, semanticRevision);
    const rebuildData = rebuilt.data as {
      readonly rebuilt: boolean;
      readonly committed: boolean;
      readonly revision: number;
      readonly index: { readonly path: string; readonly digest: string };
      readonly projection: { readonly files: string[]; readonly manifestDigest: string };
    };
    assert.equal(rebuildData.rebuilt, true);
    assert.equal(rebuildData.committed, false);
    assert.equal(rebuildData.revision, semanticRevision);
    assert.equal(rebuildData.index.path, ".justification/index.json");
    assert.match(rebuildData.index.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(rebuildData.projection.files, Object.keys(beforeProjection.files).sort());
    assert.match(rebuildData.projection.manifestDigest, /^[0-9a-f]{64}$/);

    const afterWhy = await executeOperation(root, {
      op: "why",
      nodeId: decisionId,
      kb: "shared",
      revision: semanticRevision,
      evaluationTime
    });
    assert.deepEqual(afterWhy, beforeWhy);
    assert.deepEqual(await readProjection(root), beforeProjection);
    assert.equal(await readFile(unrelatedPath, "utf8"), unrelatedText);
    const rebuiltIndex = await readFile(join(root, rebuildData.index.path), "utf8");
    assert.equal(rebuiltIndex.length > 0, true);

    const restoredRebuild = await executeOperation(restored, { op: "rebuild", actor: "operator:recovery", at: evaluationTime });
    assert.equal(restoredRebuild.revision, semanticRevision);
    const restoredWhy = await executeOperation(restored, {
      op: "why",
      nodeId: decisionId,
      kb: "shared",
      revision: semanticRevision,
      evaluationTime
    });
    assert.deepEqual(restoredWhy, beforeWhy);
    assert.deepEqual(await readProjection(restored), beforeProjection);
    assert.equal(await readFile(join(restored, "kb", "shared", "unrelated.md"), "utf8"), unrelatedText);
    assert.equal(
      (restoredRebuild.data as { readonly index: { readonly digest: string } }).index.digest,
      rebuildData.index.digest
    );
    assert.equal(await readFile(join(restored, ".justification", "index.json"), "utf8"), rebuiltIndex);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("rebuild accepts a projection generated by an older semantic revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-recovery-stale-projection-"));
  try {
    await initializeProject(root);
    const claim = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "A durable claim",
      body: "The claim was projected before the KB metadata changed.",
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });
    const claimId = (claim.data as { readonly node: { readonly id: string } }).node.id;
    const projectedRevision = claim.revision;
    const projected = await readProjection(root);

    const createdKb = await executeOperation(root, {
      op: "create_kb",
      id: "adr",
      title: "Architecture decision",
      actor: "human:recovery",
      at: "2026-09-10T09:01:00Z"
    });
    assert.equal(createdKb.revision, projectedRevision + 1);
    assert.equal(Object.hasOwn(projected.manifest.files, "kb/adr/index.md"), false);

    const evaluationTime = "2026-09-10T12:00:00Z";
    const beforeWhy = await executeOperation(root, {
      op: "why",
      nodeId: claimId,
      kb: "shared",
      evaluationTime
    });
    const latestRevision = createdKb.revision;

    await rm(join(root, ".justification"), { recursive: true, force: true });
    const rebuilt = await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: evaluationTime });
    assert.equal(rebuilt.revision, latestRevision);
    const rebuildData = rebuilt.data as {
      readonly rebuilt: boolean;
      readonly committed: boolean;
      readonly revision: number;
      readonly projection: { readonly files: readonly string[] };
    };
    assert.equal(rebuildData.rebuilt, true);
    assert.equal(rebuildData.committed, false);
    assert.equal(rebuildData.revision, latestRevision);
    assert.equal(rebuildData.projection.files.includes("kb/adr/index.md"), true);

    const afterWhy = await executeOperation(root, {
      op: "why",
      nodeId: claimId,
      kb: "shared",
      evaluationTime
    });
    assert.deepEqual(afterWhy, beforeWhy);
    const afterProjection = await readProjection(root);
    assert.equal(Object.hasOwn(afterProjection.manifest.files, "kb/adr/index.md"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild diagnoses a manual edit even when the disposable manifest hash is altered", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-recovery-manifest-tamper-"));
  try {
    await initializeProject(root);
    const recorded = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "A claim with a generated document",
      body: "The generated document is owned by the validated history.",
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });
    const nodeId = (recorded.data as { readonly node: { readonly id: string } }).node.id;
    const relativePath = `kb/shared/${nodeId}.md`;
    const projectionPath = join(root, relativePath);
    const editedText = `${await readFile(projectionPath, "utf8")}\nManual edit that is not in history.\n`;
    await writeFile(projectionPath, editedText, "utf8");

    const manifestPath = join(root, ".justification", "projection-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: Record<string, string> };
    manifest.files[relativePath] = createHash("sha256").update(editedText, "utf8").digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: "2026-09-10T12:00:00Z" }),
      (error: unknown) => {
        assert.equal((error as { readonly code?: string }).code, "PROJECTION_DRIFT");
        return true;
      }
    );
    assert.equal(await readFile(projectionPath, "utf8"), editedText);
    const current = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(current.revision, recorded.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild recovers from an invalid disposable projection manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-recovery-malformed-manifest-"));
  try {
    await initializeProject(root);
    const recorded = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "A claim with durable projection",
      body: "The generated projection remains recoverable from history.",
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });
    const nodeId = (recorded.data as { readonly node: { readonly id: string } }).node.id;
    const evaluationTime = "2026-09-10T12:00:00Z";
    const beforeWhy = await executeOperation(root, {
      op: "why",
      nodeId,
      kb: "shared",
      evaluationTime
    });
    const beforeProjection = await readProjection(root);
    const manifestPath = join(root, ".justification", "projection-manifest.json");
    await writeFile(manifestPath, "{ invalid disposable JSON\n", "utf8");

    const rebuilt = await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: evaluationTime });
    assert.equal(rebuilt.revision, recorded.revision);
    const afterWhy = await executeOperation(root, {
      op: "why",
      nodeId,
      kb: "shared",
      evaluationTime
    });
    assert.deepEqual(afterWhy, beforeWhy);
    assert.deepEqual(await readProjection(root), beforeProjection);
    const repairedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      readonly format: string;
      readonly version: number;
      readonly files: Record<string, string>;
    };
    assert.equal(repairedManifest.format, "justification.projection");
    assert.equal(repairedManifest.version, 1);
    assert.equal(Object.keys(repairedManifest.files).length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild recovers a semantic revision after projection publication fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-recovery-postcommit-failure-"));
  const derivedPath = join(root, ".justification");
  const nodeId = "00000000-0000-4000-8000-000000000002";
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "Initial projected claim",
      body: "This establishes a writable generated projection.",
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });

    await chmod(derivedPath, 0o500);
    try {
      await assert.rejects(
        executeOperation(root, {
          op: "record",
          id: nodeId,
          kb: "shared",
          kind: "claim",
          title: "Durable claim after projection failure",
          body: "The semantic revision must survive a failed projection publication.",
          actor: "human:recovery",
          at: "2026-09-10T09:01:00Z"
        }),
        (error: unknown) => {
          assert.equal((error as { readonly code?: string }).code, "PROJECTION_FAILED");
          const details = (error as { readonly details?: { readonly revision?: number; readonly committed?: boolean } }).details;
          assert.equal(details?.revision, 2);
          assert.equal(details?.committed, true);
          return true;
        }
      );
    } finally {
      await chmod(derivedPath, 0o700);
    }

    const semanticRevision = (await executeOperation(root, { op: "knowledge_bases" })).revision;
    assert.equal(semanticRevision, 2);
    const evaluationTime = "2026-09-10T12:00:00Z";
    const beforeWhy = await executeOperation(root, {
      op: "why",
      nodeId,
      kb: "shared",
      evaluationTime
    });

    const rebuilt = await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: evaluationTime });
    assert.equal(rebuilt.revision, semanticRevision);
    const rebuildData = rebuilt.data as {
      readonly rebuilt: boolean;
      readonly committed: boolean;
      readonly revision: number;
    };
    assert.equal(rebuildData.rebuilt, true);
    assert.equal(rebuildData.committed, false);
    assert.equal(rebuildData.revision, semanticRevision);

    const afterWhy = await executeOperation(root, {
      op: "why",
      nodeId,
      kb: "shared",
      evaluationTime
    });
    assert.deepEqual(afterWhy, beforeWhy);
    assert.equal((await readFile(join(root, "kb", "shared", `${nodeId}.md`), "utf8")).includes("Durable claim after projection failure"), true);
  } finally {
    await chmod(derivedPath, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild keeps disposable state ignored while preserving native project files", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-recovery-gitignore-"));
  const gitignorePath = join(root, ".gitignore");
  const existingGitignore = Buffer.from("# Existing project rules\n.tmp/\n", "utf8");
  try {
    await writeFile(gitignorePath, existingGitignore);
    await execFile("git", ["init"], { cwd: root });
    await initializeProject(root);
    const sourceLocator = "constraints.md";
    await writeFile(join(root, sourceLocator), "The service must run offline.\n", "utf8");
    await executeOperation(root, {
      op: "capture_source",
      locator: sourceLocator,
      actor: "human:recovery",
      at: "2026-09-10T09:00:00Z"
    });
    const recorded = await executeOperation(root, {
      op: "record",
      kb: "shared",
      kind: "claim",
      title: "The service runs offline",
      body: "The retained constraint supports offline operation.",
      actor: "human:recovery",
      at: "2026-09-10T09:01:00Z"
    });
    const nodeId = (recorded.data as { readonly node: { readonly id: string } }).node.id;
    const revisionPath = `justification-history/${recorded.revision.toString().padStart(12, "0")}.json`;
    const generatedPath = `kb/shared/${nodeId}.md`;

    await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: "2026-09-10T12:00:00Z" });
    const assertIgnoreLayout = async (): Promise<void> => {
      assert.equal(await isGitIgnored(root, ".justification/index.json"), true);
      assert.equal(await isGitIgnored(root, ".justification/projection-manifest.json"), true);
      assert.equal(await isGitIgnored(root, revisionPath), false);
      assert.equal(await isGitIgnored(root, generatedPath), false);
    };
    await assertIgnoreLayout();
    assert.deepEqual(await readFile(gitignorePath), existingGitignore);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    await executeOperation(root, { op: "rebuild", actor: "operator:recovery", at: "2026-09-10T12:00:00Z" });
    await assertIgnoreLayout();
    assert.deepEqual(await readFile(gitignorePath), existingGitignore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
