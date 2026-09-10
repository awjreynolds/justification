import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

type AuditFinding = {
  readonly category: string;
  readonly nodeId?: string;
  readonly sourceId?: string;
  readonly reviewId?: string;
  readonly contradictionId?: string;
  readonly status?: string;
  readonly reason?: string;
};

test("audit reports scoped support, provenance, freshness, review and artifact findings without committing", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-audit-"));
  const unsupportedClaimId = "11111111-1111-4111-8111-111111111111";
  const supportedClaimId = "22222222-2222-4222-8222-222222222222";
  const decisionId = "33333333-3333-4333-8333-333333333333";
  const artifactId = "44444444-4444-4444-8444-444444444444";
  const localAssertionId = "55555555-5555-4555-8555-555555555555";
  const siblingAssertionId = "66666666-6666-4666-8666-666666666666";
  const unsupportedDecisionId = "77777777-7777-4777-8777-777777777777";
  const artifactLocator = "report.md";
  const sourceLocator = "facts.txt";
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "local",
      title: "Local work",
      actor: "human:audit",
      at: "2026-09-10T09:00:00Z"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "sibling",
      title: "Sibling work",
      actor: "human:audit",
      at: "2026-09-10T09:01:00Z"
    });

    const initialSource = "benchmark result: PASS\n";
    await writeFile(join(root, sourceLocator), initialSource, "utf8");
    const captured = await executeOperation(root, {
      op: "capture_source",
      kb: "shared",
      locator: sourceLocator,
      actor: "human:audit",
      at: "2026-09-10T09:02:00Z"
    });
    const capturedData = captured.data as {
      readonly source: { readonly id: string };
      readonly observation: { readonly id: string };
      readonly evidence: { readonly id: string };
    };

    const supportedClaim = await executeOperation(root, {
      op: "record",
      id: supportedClaimId,
      kb: "shared",
      kind: "claim",
      title: "The benchmark passes",
      body: "The retained benchmark supports a passing result.",
      actor: "human:audit",
      at: "2026-09-10T09:03:00Z"
    });
    assert.equal((supportedClaim.data as { readonly node: { readonly id: string } }).node.id, supportedClaimId);
    await executeOperation(root, {
      op: "justify",
      kb: "shared",
      conclusion: supportedClaimId,
      groups: [[capturedData.evidence.id]],
      rationale: "The retained benchmark observation supports the claim.",
      actor: "human:audit",
      at: "2026-09-10T09:04:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: decisionId,
      kb: "shared",
      kind: "decision",
      title: "Choose the passing design",
      body: "Choose the design represented by the passing benchmark.",
      basis: [supportedClaimId],
      actor: "human:audit",
      at: "2026-09-10T09:05:00Z"
    });

    await writeFile(join(root, artifactLocator), "# Report\n\nThe benchmark passes.\n", "utf8");
    await executeOperation(root, {
      op: "record",
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Benchmark report",
      body: "The report records the selected design.",
      basis: [decisionId],
      fields: { locator: artifactLocator },
      actor: "human:audit",
      at: "2026-09-10T09:06:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: unsupportedClaimId,
      kb: "shared",
      kind: "claim",
      title: "The ungrounded result is accepted",
      body: "This claim has no declared support or provenance.",
      actor: "human:audit",
      at: "2026-09-10T09:07:00Z"
    });
    await executeOperation(root, {
      op: "record",
      kind: "decision",
      id: unsupportedDecisionId,
      kb: "shared",
      title: "Choose the ungrounded result",
      body: "This decision relies on an unsupported claim.",
      basis: [unsupportedClaimId],
      actor: "human:audit",
      at: "2026-09-10T09:08:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: localAssertionId,
      kb: "local",
      kind: "assertion",
      title: "The local assertion lacks provenance",
      body: "The local assertion has no declared source.",
      actor: "human:audit",
      at: "2026-09-10T09:09:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: siblingAssertionId,
      kb: "sibling",
      kind: "assertion",
      title: "The sibling assertion remains private",
      body: "This sibling assertion must not appear in a local audit.",
      actor: "human:audit",
      at: "2026-09-10T09:10:00Z"
    });

    await writeFile(join(root, sourceLocator), "benchmark result: FAIL\n", "utf8");
    const refreshed = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      sourceIds: [capturedData.source.id],
      actor: "human:audit",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    const refreshData = refreshed.data as {
      readonly reviews: readonly { readonly id: string; readonly nodeId: string; readonly status: string }[];
    };
    assert.deepEqual(
      new Set(refreshData.reviews.filter((review) => review.status === "open").map((review) => review.nodeId)),
      new Set([capturedData.evidence.id, supportedClaimId, decisionId, artifactId])
    );
    await writeFile(join(root, artifactLocator), "# Report\n\nThe benchmark result was edited after recording.\n", "utf8");

    const audited = await executeOperation(root, {
      op: "audit",
      kb: "local",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    assert.equal(audited.revision, refreshed.revision);
    const data = audited.data as {
      readonly scope: { readonly kb: string | null };
      readonly evaluationTime: string;
      readonly findings: readonly AuditFinding[];
    };
    assert.deepEqual(data.scope, { kb: "local" });
    assert.equal(data.evaluationTime, "2026-09-10T10:00:00.000Z");
    const findings = data.findings.map(({ category, nodeId, sourceId, reviewId }) => ({
      category,
      ...(nodeId === undefined ? {} : { nodeId }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(reviewId === undefined ? {} : { reviewId })
    }));
    const expected = [
      { category: "unsupported", nodeId: unsupportedDecisionId },
      { category: "unsupported", nodeId: decisionId },
      { category: "unsupported", nodeId: artifactId },
      { category: "missing_provenance", nodeId: unsupportedClaimId },
      { category: "missing_provenance", nodeId: localAssertionId },
      { category: "source_freshness", sourceId: capturedData.source.id },
      ...refreshData.reviews
        .filter((review) => review.status === "open")
        .map((review) => ({ category: "open_review", nodeId: review.nodeId, reviewId: review.id })),
      { category: "artifact_drift", nodeId: artifactId }
    ];
    const key = (finding: AuditFinding): string => JSON.stringify([finding.category, finding.nodeId ?? "", finding.sourceId ?? "", finding.reviewId ?? ""]);
    assert.deepEqual(findings.sort((left, right) => key(left).localeCompare(key(right))), expected.sort((left, right) => key(left).localeCompare(key(right))));
    assert.equal(findings.some((finding) => finding.nodeId === siblingAssertionId), false);

    const afterAudit = await executeOperation(root, { op: "knowledge_bases" });
    assert.equal(afterAudit.revision, refreshed.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit includes a child-owned contradiction over shared knowledge only in the child scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-audit-contradiction-scope-"));
  const sharedOptionId = "88888888-8888-4888-8888-888888888888";
  const localOptionId = "99999999-9999-4999-8999-999999999999";
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "local",
      title: "Local work",
      actor: "human:audit",
      at: "2026-09-10T09:00:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: sharedOptionId,
      kb: "shared",
      kind: "option",
      title: "Shared option",
      body: "The shared option is available to child work.",
      actor: "human:audit",
      at: "2026-09-10T09:01:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: localOptionId,
      kb: "local",
      kind: "option",
      title: "Local option",
      body: "The local option differs from the shared option.",
      actor: "human:audit",
      at: "2026-09-10T09:02:00Z"
    });
    const contradicted = await executeOperation(root, {
      op: "contradict",
      kb: "local",
      left: localOptionId,
      right: sharedOptionId,
      rationale: "The local and shared options cannot both be selected here.",
      actor: "human:audit",
      at: "2026-09-10T09:03:00Z"
    });
    const contradiction = (contradicted.data as { readonly contradiction: { readonly id: string; readonly kb: string } }).contradiction;
    assert.equal(contradiction.kb, "local");

    const childAudit = await executeOperation(root, {
      op: "audit",
      kb: "local",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    const childFindings = (childAudit.data as { readonly findings: readonly AuditFinding[] }).findings;
    assert.deepEqual(
      childFindings.filter((finding) => finding.category === "open_contradiction").map((finding) => finding.contradictionId),
      [contradiction.id]
    );
    assert.equal(childFindings.some((finding) => finding.category === "open_review" && finding.nodeId === localOptionId), true);

    const sharedAudit = await executeOperation(root, {
      op: "audit",
      kb: "shared",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    const sharedFindings = (sharedAudit.data as { readonly findings: readonly AuditFinding[] }).findings;
    assert.equal(sharedFindings.some((finding) => finding.contradictionId === contradiction.id), false);
    assert.equal(sharedFindings.some((finding) => finding.nodeId === localOptionId), false);
    assert.equal(sharedAudit.revision, contradicted.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit reports missing and unavailable artifact files with provider diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-audit-artifacts-"));
  const missingOptionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const unavailableOptionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const missingArtifactId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const unavailableArtifactId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const missingLocator = "missing-report.md";
  const unavailableLocator = "unavailable-report.md";
  const unavailableBytes = Buffer.from([0xff, 0xfe, 0xfd]);
  try {
    await initializeProject(root);
    await writeFile(join(root, missingLocator), "# Report that will be removed\n", "utf8");
    await writeFile(join(root, unavailableLocator), "# Report that will become unavailable\n", "utf8");
    await executeOperation(root, {
      op: "record",
      id: missingOptionId,
      kb: "shared",
      kind: "option",
      title: "Missing report option",
      body: "An option used only to establish the artifact basis.",
      actor: "human:audit",
      at: "2026-09-10T09:00:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: unavailableOptionId,
      kb: "shared",
      kind: "option",
      title: "Unavailable report option",
      body: "Another option used only to establish the artifact basis.",
      actor: "human:audit",
      at: "2026-09-10T09:01:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: missingArtifactId,
      kb: "shared",
      kind: "artifact",
      title: "Missing report",
      body: "The recorded report is removed before the audit.",
      basis: [missingOptionId],
      fields: { locator: missingLocator },
      actor: "human:audit",
      at: "2026-09-10T09:02:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: unavailableArtifactId,
      kb: "shared",
      kind: "artifact",
      title: "Unavailable report",
      body: "The recorded report is replaced with invalid UTF-8 before the audit.",
      basis: [unavailableOptionId],
      fields: { locator: unavailableLocator },
      actor: "human:audit",
      at: "2026-09-10T09:03:00Z"
    });

    await rm(join(root, missingLocator));
    await writeFile(join(root, unavailableLocator), unavailableBytes);
    const beforeAudit = await executeOperation(root, { op: "knowledge_bases" });
    const audited = await executeOperation(root, {
      op: "audit",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    const findings = (audited.data as { readonly findings: readonly AuditFinding[] }).findings
      .filter((finding) => finding.category === "artifact_drift")
      .map((finding) => ({ nodeId: finding.nodeId, status: finding.status, reason: finding.reason }))
      .sort((left, right) => (left.nodeId ?? "").localeCompare(right.nodeId ?? ""));
    assert.deepEqual(findings.map(({ nodeId, status }) => ({ nodeId, status })), [
      { nodeId: missingArtifactId, status: "missing" },
      { nodeId: unavailableArtifactId, status: "unavailable" }
    ]);
    assert.match(findings[0]?.reason ?? "", /missing-report\.md|does not exist/u);
    assert.match(findings[1]?.reason ?? "", /unavailable-report\.md|UTF-8/u);
    assert.equal(audited.revision, beforeAudit.revision);
    assert.deepEqual(await readFile(join(root, unavailableLocator)), unavailableBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
