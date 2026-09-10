#!/usr/bin/env node

/**
 * Run the fictional checkout-cache ADR proof against the built public runtime.
 *
 * The script intentionally creates its own project roots. Pass --root to keep
 * the generated projects in an existing empty directory; without it a new
 * temporary directory is created and left in place for inspection.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";

import { executeOperation, initializeProject } from "../dist/index.js";

const ACTOR = "fixture-agent";
const EVALUATION_TIME = "2026-01-01T00:00:00.000Z";
const CHILD_KB = "checkout-cache";

const INITIAL_BENCHMARK = `# Fictional cache benchmark

fixture-version: 1

| Option | p95 miss latency | Survives process restart |
| --- | ---: | --- |
| Redis | 82 ms | yes |
| SQLite | 191 ms | yes |
| Memory | 41 ms | no |
`;

const CHANGED_BENCHMARK = `# Fictional cache benchmark

fixture-version: 2

| Option | p95 miss latency | Survives process restart |
| --- | ---: | --- |
| Redis | 171 ms | yes |
| SQLite | 191 ms | yes |
| Memory | 41 ms | no |
`;

const ADR_TEXT = `# ADR-0001: Choose Redis for the checkout cache

Status: accepted

The checkout-cache experiment selects Redis because the fictional benchmark
keeps its p95 miss latency below the shared 150 ms constraint and survives a
process restart.
`;

function parseArgs(argv) {
  if (argv.length === 0) return { root: undefined };
  if (argv.length === 2 && argv[0] === "--root") return { root: resolve(argv[1]) };
  throw new Error("usage: node examples/adr-demo.mjs [--root EMPTY_DIRECTORY]");
}

async function prepareWorkspace(requestedRoot) {
  if (requestedRoot === undefined) {
    return mkdtemp(join(tmpdir(), "justification-adr-demo-"));
  }

  await mkdir(requestedRoot, { recursive: true });
  const info = await stat(requestedRoot);
  if (!info.isDirectory()) throw new Error(`--root is not a directory: ${requestedRoot}`);
  const entries = await readdir(requestedRoot);
  if (entries.length !== 0) {
    throw new Error(`--root must be empty; refusing to write into ${requestedRoot}`);
  }
  return requestedRoot;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(value, visit) {
  if (visit(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, visit);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const found = walk(item, visit);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function idWithKind(response, kind) {
  const found = walk(response, (value) =>
    isRecord(value) && value.kind === kind && typeof value.id === "string"
  );
  if (found !== undefined) return found.id;

  // capture_source may return stable IDs directly while record returns the
  // complete node. Keep this fallback at the transport boundary so the demo
  // remains independent of the runtime's internal state shape.
  const field = kind === "source"
    ? "sourceId"
    : kind === "evidence"
      ? "evidenceId"
      : "nodeId";
  if (field !== undefined) {
    const direct = walk(response, (value) =>
      isRecord(value) && typeof value[field] === "string"
    );
    if (direct !== undefined) return direct[field];
  }
  throw new Error(`operation response did not contain a ${kind} node`);
}

function hasEveryId(value, ids) {
  const serialized = JSON.stringify(value);
  return ids.every((id) => serialized.includes(id));
}

function dataOf(response) {
  assert.equal(typeof response, "object");
  assert.equal(typeof response.revision, "number");
  return response.data;
}

async function run() {
  const { root: requestedRoot } = parseArgs(process.argv.slice(2));
  const workspace = await prepareWorkspace(requestedRoot);
  const projectA = join(workspace, "acme-checkout");
  const projectB = join(workspace, "acme-search");
  const sourceLocator = "evidence/cache-benchmark.md";
  const artifactLocator = "adr/ADR-0001.md";

  await mkdir(join(projectA, "evidence"), { recursive: true });
  await mkdir(join(projectA, "adr"), { recursive: true });
  await writeFile(join(projectA, sourceLocator), INITIAL_BENCHMARK, "utf8");
  await writeFile(join(projectA, artifactLocator), ADR_TEXT, "utf8");
  await mkdir(projectB, { recursive: true });
  await writeFile(join(projectB, "README.md"), "Unrelated fictional project.\n", "utf8");

  await initializeProject(projectA);
  await initializeProject(projectB);

  const projectBKbs = await executeOperation(projectB, { op: "knowledge_bases" });
  assert.equal(projectBKbs.revision, 0, "the unrelated project starts at revision zero");

  await executeOperation(projectA, {
    op: "create_kb",
    id: CHILD_KB,
    title: "Checkout cache experiment",
    actor: ACTOR
  });

  const constraintResponse = await executeOperation(projectA, {
    op: "record",
    kb: "shared",
    kind: "requirement",
    title: "Checkout p95 latency constraint",
    body: "Checkout reads must stay below 150 ms at p95, including a cache miss.",
    actor: ACTOR
  });
  const constraintId = idWithKind(constraintResponse, "requirement");

  const optionIds = {};
  for (const [title, body] of [
    ["Redis", "Managed Redis-compatible cache with replication."],
    ["SQLite", "Local SQLite database on the application host."],
    ["Memory", "In-process LRU cache."]
  ]) {
    const response = await executeOperation(projectA, {
      op: "record",
      kb: CHILD_KB,
      kind: "option",
      title,
      body,
      actor: ACTOR
    });
    optionIds[title] = idWithKind(response, "option");
  }

  const captureResponse = await executeOperation(projectA, {
    op: "capture_source",
    kb: CHILD_KB,
    locator: sourceLocator,
    title: "Fictional cache benchmark",
    actor: ACTOR
  });
  const sourceId = idWithKind(captureResponse, "source");
  const evidenceId = idWithKind(captureResponse, "evidence");

  const claimResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "claim",
    title: "Redis is the only qualifying cache option",
    body: "Within this fictional benchmark, Redis is the only option meeting the latency and restart requirements.",
    basis: [constraintId, evidenceId],
    actor: ACTOR
  });
  const claimId = idWithKind(claimResponse, "claim");

  const decisionResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "decision",
    title: "Choose Redis for the checkout cache",
    body: "Select Redis for the checkout cache in the fictional experiment.",
    basis: [constraintId, claimId],
    fields: {
      consideredOptions: [optionIds.Redis, optionIds.SQLite, optionIds.Memory],
      selectedOption: optionIds.Redis,
      rationale: "Redis alone meets both declared requirements in the retained benchmark."
    },
    actor: ACTOR
  });
  const decisionId = idWithKind(decisionResponse, "decision");
  const acceptanceRevision = decisionResponse.revision;

  const artifactResponse = await executeOperation(projectA, {
    op: "record",
    kb: CHILD_KB,
    kind: "artifact",
    title: "ADR-0001: Choose Redis for the checkout cache",
    body: ADR_TEXT,
    basis: [decisionId],
    fields: {
      locator: artifactLocator,
      digest: sha256(ADR_TEXT)
    },
    actor: ACTOR
  });
  const artifactId = idWithKind(artifactResponse, "artifact");

  const historicalBefore = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    revision: acceptanceRevision,
    evaluationTime: EVALUATION_TIME
  });
  assert.match(JSON.stringify(dataOf(historicalBefore)), /82 ms/);
  assert.ok(hasEveryId(historicalBefore, [constraintId, claimId, evidenceId]));

  const currentBefore = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  assert.match(JSON.stringify(dataOf(currentBefore)), /82 ms/);

  await writeFile(join(projectA, sourceLocator), CHANGED_BENCHMARK, "utf8");
  const refreshResponse = await executeOperation(projectA, {
    op: "refresh",
    kb: CHILD_KB,
    actor: ACTOR,
    evaluationTime: EVALUATION_TIME
  });
  assert.ok(refreshResponse.revision > currentBefore.revision);
  assert.ok(
    hasEveryId(refreshResponse, [evidenceId, claimId, decisionId, artifactId]),
    "refresh reports the retained evidence and all declared downstream dependants"
  );

  const currentAfter = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  assert.match(JSON.stringify(dataOf(currentAfter)), /171 ms/);
  assert.ok(hasEveryId(currentAfter, [claimId, decisionId, artifactId]));

  const unchangedRefresh = await executeOperation(projectA, {
    op: "refresh",
    kb: CHILD_KB,
    actor: ACTOR,
    evaluationTime: EVALUATION_TIME
  });
  assert.equal(
    unchangedRefresh.revision,
    refreshResponse.revision,
    "refreshing unchanged bytes creates no semantic revision"
  );
  assert.deepEqual(unchangedRefresh.data, { changes: [], reviews: [] });

  const historicalAfter = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    revision: acceptanceRevision,
    evaluationTime: EVALUATION_TIME
  });
  assert.deepEqual(historicalAfter.data, historicalBefore.data);

  const beforeRebuild = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  await rm(join(projectA, ".justification"), { recursive: true, force: true });
  const rebuildResponse = await executeOperation(projectA, { op: "rebuild", actor: ACTOR });
  assert.equal(rebuildResponse.revision, beforeRebuild.revision);
  const afterRebuild = await executeOperation(projectA, {
    op: "why",
    nodeId: decisionId,
    evaluationTime: EVALUATION_TIME
  });
  assert.deepEqual(afterRebuild.data, beforeRebuild.data);

  const projectBAfter = await executeOperation(projectB, { op: "knowledge_bases" });
  assert.equal(projectBAfter.revision, projectBKbs.revision, "the unrelated project is unchanged");

  console.log(JSON.stringify({
    ok: true,
    projects: [projectA, projectB],
    projectRoot: workspace,
    childKnowledgeBase: CHILD_KB,
    ids: { sourceId, evidenceId, claimId, decisionId, artifactId },
    acceptanceRevision,
    changedRevision: refreshResponse.revision,
    unchangedRefreshRevision: unchangedRefresh.revision,
    rebuiltRevision: rebuildResponse.revision,
    historicalWhyRevision: acceptanceRevision,
    currentReview: "changed source is visible through evidence, claim, decision and artifact"
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});
