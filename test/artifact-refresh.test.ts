import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeOperation, initializeProject } from "../src/index.ts";

type ArtifactNode = {
  readonly id: string;
  readonly fields?: {
    readonly digest?: string;
  };
};

type Review = {
  readonly id: string;
  readonly nodeId: string;
  readonly triggerType: string;
  readonly triggerId: string;
  readonly status: string;
};

test("refresh records and durably deduplicates artifact drift reviews", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-artifact-refresh-"));
  const supportId = "11111111-1111-4111-8111-111111111111";
  const artifactId = "22222222-2222-4222-8222-222222222222";
  const locator = "output.md";
  const initialText = "# Accepted output\n\nThe selected option is local.\n";
  const changedText = "# Accepted output\n\nThe selected option is remote.\n";
  try {
    await initializeProject(root);
    await writeFile(join(root, locator), initialText, "utf8");
    await executeOperation(root, {
      op: "record",
      id: supportId,
      kb: "shared",
      kind: "assumption",
      title: "The accepted support premise",
      body: "This premise is explicitly accepted for the artifact.",
      fields: { accepted: true },
      actor: "human:artifact-refresh",
      at: "2026-09-10T09:00:00Z"
    });
    const recorded = await executeOperation(root, {
      op: "record",
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Accepted output",
      body: initialText,
      basis: [supportId],
      fields: { locator },
      actor: "human:artifact-refresh",
      at: "2026-09-10T09:01:00Z"
    });
    const recordedNode = (recorded.data as { readonly node: ArtifactNode }).node;
    const acceptedDigest = recordedNode.fields?.digest;
    assert.match(acceptedDigest ?? "", /^[0-9a-f]{64}$/u);
    const semanticRevision = recorded.revision;

    await writeFile(join(root, locator), changedText, "utf8");
    const changedBytes = await readFile(join(root, locator));
    const refreshed = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-refresh",
      at: "2026-09-10T10:00:00Z"
    });
    assert.equal(refreshed.revision, semanticRevision + 1);
    const firstRefresh = refreshed.data as {
      readonly changed: boolean;
      readonly reviews: readonly Review[];
    };
    assert.equal(firstRefresh.changed, true);
    const driftReviews = firstRefresh.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(driftReviews.length, 1);
    assert.equal(driftReviews[0]?.status, "open");
    assert.equal(typeof driftReviews[0]?.triggerId, "string");
    assert.deepEqual(await readFile(join(root, locator)), changedBytes);

    const explained = await executeOperation(root, {
      op: "why",
      nodeId: artifactId,
      kb: "shared",
      evaluationTime: "2026-09-10T10:00:00Z"
    });
    const explainedNode = (explained.data as { readonly node: ArtifactNode }).node;
    assert.equal(explainedNode.fields?.digest, acceptedDigest);

    const repeated = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-refresh",
      at: "2026-09-10T10:01:00Z"
    });
    assert.equal(repeated.revision, refreshed.revision);
    const repeatedData = repeated.data as {
      readonly changed: boolean;
      readonly reviews: readonly Review[];
    };
    assert.equal(repeatedData.changed, false);
    assert.equal(repeatedData.reviews.length, 0);

    const listedBeforeRebuild = await executeOperation(root, { op: "review", kb: "shared", status: "open" });
    const listedReviewsBeforeRebuild = (listedBeforeRebuild.data as { readonly reviews: readonly Review[] }).reviews
      .filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(listedReviewsBeforeRebuild.length, 1);
    assert.equal(listedReviewsBeforeRebuild[0]?.id, driftReviews[0]?.id);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    const rebuilt = await executeOperation(root, {
      op: "rebuild",
      actor: "operator:artifact-refresh",
      at: "2026-09-10T10:02:00Z"
    });
    assert.equal(rebuilt.revision, refreshed.revision);
    assert.deepEqual(await readFile(join(root, locator)), changedBytes);
    const rebuiltWhy = await executeOperation(root, {
      op: "why",
      nodeId: artifactId,
      kb: "shared",
      evaluationTime: "2026-09-10T10:02:00Z"
    });
    assert.equal((rebuiltWhy.data as { readonly node: ArtifactNode }).node.fields?.digest, acceptedDigest);

    const afterRebuildRefresh = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-refresh",
      at: "2026-09-10T10:03:00Z"
    });
    assert.equal(afterRebuildRefresh.revision, refreshed.revision);
    const afterRebuildData = afterRebuildRefresh.data as {
      readonly changed: boolean;
      readonly reviews: readonly Review[];
    };
    assert.equal(afterRebuildData.changed, false);
    assert.equal(afterRebuildData.reviews.length, 0);
    const listedAfterRebuild = await executeOperation(root, { op: "review", kb: "shared", status: "open" });
    const listedReviewsAfterRebuild = (listedAfterRebuild.data as { readonly reviews: readonly Review[] }).reviews
      .filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(listedReviewsAfterRebuild.length, 1);
    assert.equal(listedReviewsAfterRebuild[0]?.id, driftReviews[0]?.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh retains restoration before reopening a later distinct artifact drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-artifact-restoration-"));
  const supportId = "33333333-3333-4333-8333-333333333333";
  const artifactId = "44444444-4444-4444-8444-444444444444";
  const locator = "output.md";
  const acceptedText = "# Accepted output\n\nThe selected option is local.\n";
  const changedText = "# Accepted output\n\nThe selected option is remote.\n";
  try {
    await initializeProject(root);
    await writeFile(join(root, locator), acceptedText, "utf8");
    await executeOperation(root, {
      op: "record",
      id: supportId,
      kb: "shared",
      kind: "assumption",
      title: "The accepted support premise",
      body: "This premise is explicitly accepted for the artifact.",
      fields: { accepted: true },
      actor: "human:artifact-restoration",
      at: "2026-09-10T09:00:00Z"
    });
    const recorded = await executeOperation(root, {
      op: "record",
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Accepted output",
      body: acceptedText,
      basis: [supportId],
      fields: { locator },
      actor: "human:artifact-restoration",
      at: "2026-09-10T09:01:00Z"
    });
    const acceptedDigest = (recorded.data as { readonly node: ArtifactNode }).node.fields?.digest;
    assert.match(acceptedDigest ?? "", /^[0-9a-f]{64}$/u);
    const acceptedRevision = recorded.revision;

    await writeFile(join(root, locator), changedText, "utf8");
    const first = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-restoration",
      at: "2026-09-10T10:00:00Z"
    });
    assert.equal(first.revision, acceptedRevision + 1);
    const firstData = first.data as {
      readonly changed: boolean;
      readonly artifactDrifts: readonly [{ readonly id: string; readonly after: { readonly digest?: string } }];
      readonly reviews: readonly Review[];
    };
    assert.equal(firstData.changed, true);
    assert.equal(firstData.artifactDrifts.length, 1);
    assert.equal(firstData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    await writeFile(join(root, locator), acceptedText, "utf8");
    const restored = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-restoration",
      at: "2026-09-10T10:01:00Z"
    });
    assert.equal(restored.revision, first.revision + 1);
    const restoredData = restored.data as {
      readonly changed: boolean;
      readonly artifactDrifts: readonly [{ readonly before: { readonly digest?: string }; readonly after: { readonly digest?: string } }];
      readonly reviews: readonly Review[];
    };
    assert.equal(restoredData.changed, true);
    assert.equal(restoredData.artifactDrifts.length, 1);
    assert.equal(restoredData.artifactDrifts[0]?.before.digest, firstData.artifactDrifts[0]?.after.digest);
    assert.equal(restoredData.artifactDrifts[0]?.after.digest, acceptedDigest);
    assert.equal(restoredData.reviews.length, 0);

    await writeFile(join(root, locator), changedText, "utf8");
    const secondDrift = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-restoration",
      at: "2026-09-10T10:02:00Z"
    });
    assert.equal(secondDrift.revision, restored.revision + 1);
    const secondData = secondDrift.data as {
      readonly changed: boolean;
      readonly artifactDrifts: readonly [{ readonly before: { readonly digest?: string }; readonly after: { readonly digest?: string } }];
      readonly reviews: readonly Review[];
    };
    assert.equal(secondData.changed, true);
    assert.equal(secondData.artifactDrifts.length, 1);
    assert.equal(secondData.artifactDrifts[0]?.before.digest, acceptedDigest);
    assert.notEqual(secondData.artifactDrifts[0]?.after.digest, acceptedDigest);
    assert.equal(secondData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    const listed = await executeOperation(root, { op: "review", kb: "shared", status: "open" });
    const artifactReviews = (listed.data as { readonly reviews: readonly Review[] }).reviews
      .filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(artifactReviews.length, 2);
    assert.notEqual(artifactReviews[0]?.triggerId, artifactReviews[1]?.triggerId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh durably deduplicates a missing artifact state across rebuild", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-artifact-missing-"));
  const supportId = "55555555-5555-4555-8555-555555555555";
  const artifactId = "66666666-6666-4666-8666-666666666666";
  const locator = "missing-output.md";
  const acceptedText = "# Accepted output\n\nThe selected option is local.\n";
  const laterText = "# Accepted output\n\nThe selected option is updated.\n";
  try {
    await initializeProject(root);
    await writeFile(join(root, locator), acceptedText, "utf8");
    await executeOperation(root, {
      op: "record",
      id: supportId,
      kb: "shared",
      kind: "assumption",
      title: "The accepted support premise",
      body: "This premise is explicitly accepted for the artifact.",
      fields: { accepted: true },
      actor: "human:artifact-missing",
      at: "2026-09-10T09:00:00Z"
    });
    const recorded = await executeOperation(root, {
      op: "record",
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Accepted output",
      body: acceptedText,
      basis: [supportId],
      fields: { locator },
      actor: "human:artifact-missing",
      at: "2026-09-10T09:01:00Z"
    });
    const acceptedRevision = recorded.revision;

    await rm(join(root, locator));
    const missing = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-missing",
      at: "2026-09-10T10:00:00Z"
    });
    assert.equal(missing.revision, acceptedRevision + 1);
    const missingData = missing.data as {
      readonly changed: boolean;
      readonly artifactDrifts: readonly [{ readonly after: { readonly status: string } }];
      readonly reviews: readonly Review[];
    };
    assert.equal(missingData.changed, true);
    assert.equal(missingData.artifactDrifts[0]?.after.status, "missing");
    assert.equal(missingData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    const repeated = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-missing",
      at: "2026-09-10T10:01:00Z"
    });
    assert.equal(repeated.revision, missing.revision);
    assert.equal((repeated.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).changed, false);
    assert.equal((repeated.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).reviews.length, 0);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    const rebuilt = await executeOperation(root, {
      op: "rebuild",
      actor: "operator:artifact-missing",
      at: "2026-09-10T10:02:00Z"
    });
    assert.equal(rebuilt.revision, missing.revision);
    const afterRebuild = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-missing",
      at: "2026-09-10T10:03:00Z"
    });
    assert.equal(afterRebuild.revision, missing.revision);
    assert.equal((afterRebuild.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).changed, false);

    await writeFile(join(root, locator), laterText, "utf8");
    const later = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-missing",
      at: "2026-09-10T10:04:00Z"
    });
    assert.equal(later.revision, missing.revision + 1);
    const laterData = later.data as { readonly changed: boolean; readonly artifactDrifts: readonly [{ readonly before: { readonly status: string }; readonly after: { readonly status: string } }]; readonly reviews: readonly Review[] };
    assert.equal(laterData.changed, true);
    assert.equal(laterData.artifactDrifts[0]?.before.status, "missing");
    assert.equal(laterData.artifactDrifts[0]?.after.status, "present");
    assert.equal(laterData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    const listed = await executeOperation(root, { op: "review", kb: "shared", status: "open" });
    const artifactReviews = (listed.data as { readonly reviews: readonly Review[] }).reviews
      .filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(artifactReviews.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh durably deduplicates an invalid UTF-8 artifact state across rebuild", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-artifact-invalid-utf8-"));
  const supportId = "77777777-7777-4777-8777-777777777777";
  const artifactId = "88888888-8888-4888-8888-888888888888";
  const locator = "invalid-output.md";
  const acceptedText = "# Accepted output\n\nThe selected option is local.\n";
  const laterText = "# Accepted output\n\nThe selected option is updated.\n";
  try {
    await initializeProject(root);
    await writeFile(join(root, locator), acceptedText, "utf8");
    await executeOperation(root, {
      op: "record",
      id: supportId,
      kb: "shared",
      kind: "assumption",
      title: "The accepted support premise",
      body: "This premise is explicitly accepted for the artifact.",
      fields: { accepted: true },
      actor: "human:artifact-invalid-utf8",
      at: "2026-09-10T09:00:00Z"
    });
    const recorded = await executeOperation(root, {
      op: "record",
      id: artifactId,
      kb: "shared",
      kind: "artifact",
      title: "Accepted output",
      body: acceptedText,
      basis: [supportId],
      fields: { locator },
      actor: "human:artifact-invalid-utf8",
      at: "2026-09-10T09:01:00Z"
    });
    const acceptedRevision = recorded.revision;

    await writeFile(join(root, locator), Buffer.from([0xff, 0xfe, 0xfd]));
    const invalid = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-invalid-utf8",
      at: "2026-09-10T10:00:00Z"
    });
    assert.equal(invalid.revision, acceptedRevision + 1);
    const invalidData = invalid.data as {
      readonly changed: boolean;
      readonly artifactDrifts: readonly [{ readonly after: { readonly status: string; readonly diagnostics?: string } }];
      readonly reviews: readonly Review[];
    };
    assert.equal(invalidData.changed, true);
    assert.equal(invalidData.artifactDrifts[0]?.after.status, "unavailable");
    assert.match(invalidData.artifactDrifts[0]?.after.diagnostics ?? "", /UTF-8/u);
    assert.equal(invalidData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    const repeated = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-invalid-utf8",
      at: "2026-09-10T10:01:00Z"
    });
    assert.equal(repeated.revision, invalid.revision);
    assert.equal((repeated.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).changed, false);
    assert.equal((repeated.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).reviews.length, 0);

    await rm(join(root, ".justification"), { recursive: true, force: true });
    const rebuilt = await executeOperation(root, {
      op: "rebuild",
      actor: "operator:artifact-invalid-utf8",
      at: "2026-09-10T10:02:00Z"
    });
    assert.equal(rebuilt.revision, invalid.revision);
    const afterRebuild = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-invalid-utf8",
      at: "2026-09-10T10:03:00Z"
    });
    assert.equal(afterRebuild.revision, invalid.revision);
    assert.equal((afterRebuild.data as { readonly changed: boolean; readonly reviews: readonly Review[] }).changed, false);

    await writeFile(join(root, locator), laterText, "utf8");
    const later = await executeOperation(root, {
      op: "refresh",
      kb: "shared",
      actor: "operator:artifact-invalid-utf8",
      at: "2026-09-10T10:04:00Z"
    });
    assert.equal(later.revision, invalid.revision + 1);
    const laterData = later.data as { readonly changed: boolean; readonly artifactDrifts: readonly [{ readonly before: { readonly status: string }; readonly after: { readonly status: string } }]; readonly reviews: readonly Review[] };
    assert.equal(laterData.changed, true);
    assert.equal(laterData.artifactDrifts[0]?.before.status, "unavailable");
    assert.equal(laterData.artifactDrifts[0]?.after.status, "present");
    assert.equal(laterData.reviews.filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift").length, 1);

    const listed = await executeOperation(root, { op: "review", kb: "shared", status: "open" });
    const artifactReviews = (listed.data as { readonly reviews: readonly Review[] }).reviews
      .filter((review) => review.nodeId === artifactId && review.triggerType === "artifact_drift");
    assert.equal(artifactReviews.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh isolates child artifacts and sourceIds select sources without artifact probes", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-artifact-scope-"));
  const sourceOneId = "99999999-9999-4999-8999-999999999999";
  const sourceTwoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const supportOneId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const supportTwoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const artifactOneId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const artifactTwoId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const sourceOneLocator = "source-one.md";
  const sourceTwoLocator = "source-two.md";
  const artifactOneLocator = "artifact-one.md";
  const artifactTwoLocator = "artifact-two.md";
  const sourceOneInitial = "source one initial\n";
  const sourceOneChanged = "source one changed\n";
  const artifactOneInitial = "artifact one accepted\n";
  const artifactOneChanged = "artifact one first drift\n";
  const artifactOneLater = "artifact one second drift\n";
  const artifactTwoInitial = "artifact two accepted\n";
  const artifactTwoChanged = "artifact two drift\n";
  try {
    await initializeProject(root);
    await executeOperation(root, {
      op: "create_kb",
      id: "one",
      title: "Child one",
      actor: "human:artifact-scope",
      at: "2026-09-10T08:00:00Z"
    });
    await executeOperation(root, {
      op: "create_kb",
      id: "two",
      title: "Child two",
      actor: "human:artifact-scope",
      at: "2026-09-10T08:01:00Z"
    });
    await writeFile(join(root, sourceOneLocator), sourceOneInitial, "utf8");
    await writeFile(join(root, sourceTwoLocator), "source two initial\n", "utf8");
    await writeFile(join(root, artifactOneLocator), artifactOneInitial, "utf8");
    await writeFile(join(root, artifactTwoLocator), artifactTwoInitial, "utf8");

    await executeOperation(root, {
      op: "record",
      id: supportOneId,
      kb: "one",
      kind: "assumption",
      title: "Child one accepted premise",
      body: "The child one artifact has an accepted basis.",
      fields: { accepted: true },
      actor: "human:artifact-scope",
      at: "2026-09-10T08:02:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: supportTwoId,
      kb: "two",
      kind: "assumption",
      title: "Child two accepted premise",
      body: "The child two artifact has an accepted basis.",
      fields: { accepted: true },
      actor: "human:artifact-scope",
      at: "2026-09-10T08:03:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: artifactOneId,
      kb: "one",
      kind: "artifact",
      title: "Child one artifact",
      body: artifactOneInitial,
      basis: [supportOneId],
      fields: { locator: artifactOneLocator },
      actor: "human:artifact-scope",
      at: "2026-09-10T08:04:00Z"
    });
    await executeOperation(root, {
      op: "record",
      id: artifactTwoId,
      kb: "two",
      kind: "artifact",
      title: "Child two artifact",
      body: artifactTwoInitial,
      basis: [supportTwoId],
      fields: { locator: artifactTwoLocator },
      actor: "human:artifact-scope",
      at: "2026-09-10T08:05:00Z"
    });
    await executeOperation(root, {
      op: "capture_source",
      sourceId: sourceOneId,
      locator: sourceOneLocator,
      kb: "one",
      actor: "human:artifact-scope",
      at: "2026-09-10T08:06:00Z"
    });
    await executeOperation(root, {
      op: "capture_source",
      sourceId: sourceTwoId,
      locator: sourceTwoLocator,
      kb: "two",
      actor: "human:artifact-scope",
      at: "2026-09-10T08:07:00Z"
    });

    await writeFile(join(root, sourceOneLocator), sourceOneChanged, "utf8");
    await writeFile(join(root, artifactOneLocator), artifactOneChanged, "utf8");
    await writeFile(join(root, artifactTwoLocator), artifactTwoChanged, "utf8");
    const first = await executeOperation(root, {
      op: "refresh",
      kb: "one",
      actor: "operator:artifact-scope",
      at: "2026-09-10T10:00:00Z"
    });
    const firstData = first.data as { readonly changed: boolean; readonly reviews: readonly Review[] };
    assert.equal(firstData.changed, true);
    assert.equal(firstData.reviews.filter((review) => review.nodeId === artifactOneId && review.triggerType === "artifact_drift").length, 1);
    assert.equal(firstData.reviews.some((review) => review.nodeId === artifactTwoId), false);
    const childTwoBeforeRefresh = await executeOperation(root, { op: "review", kb: "two", status: "open" });
    assert.equal((childTwoBeforeRefresh.data as { readonly reviews: readonly Review[] }).reviews.length, 0);

    await writeFile(join(root, artifactOneLocator), artifactOneLater, "utf8");
    const sourceOnly = await executeOperation(root, {
      op: "refresh",
      sourceIds: [sourceOneId],
      kb: "one",
      actor: "operator:artifact-scope",
      at: "2026-09-10T10:01:00Z"
    });
    assert.equal(sourceOnly.revision, first.revision);
    const sourceOnlyData = sourceOnly.data as { readonly changed: boolean; readonly artifactDrifts: readonly unknown[]; readonly reviews: readonly Review[] };
    assert.equal(sourceOnlyData.changed, false);
    assert.equal(sourceOnlyData.artifactDrifts.length, 0);
    assert.equal(sourceOnlyData.reviews.length, 0);

    const secondOne = await executeOperation(root, {
      op: "refresh",
      kb: "one",
      actor: "operator:artifact-scope",
      at: "2026-09-10T10:02:00Z"
    });
    assert.equal(secondOne.revision, first.revision + 1);
    const secondOneData = secondOne.data as { readonly changed: boolean; readonly reviews: readonly Review[] };
    assert.equal(secondOneData.reviews.filter((review) => review.nodeId === artifactOneId && review.triggerType === "artifact_drift").length, 1);
    assert.equal(secondOneData.reviews.some((review) => review.nodeId === artifactTwoId), false);

    const secondTwo = await executeOperation(root, {
      op: "refresh",
      kb: "two",
      actor: "operator:artifact-scope",
      at: "2026-09-10T10:03:00Z"
    });
    assert.equal(secondTwo.revision, secondOne.revision + 1);
    const secondTwoData = secondTwo.data as { readonly changed: boolean; readonly reviews: readonly Review[] };
    assert.equal(secondTwoData.reviews.filter((review) => review.nodeId === artifactTwoId && review.triggerType === "artifact_drift").length, 1);
    const childOneReviews = await executeOperation(root, { op: "review", kb: "one", status: "open" });
    assert.equal((childOneReviews.data as { readonly reviews: readonly Review[] }).reviews.filter((review) => review.nodeId === artifactTwoId).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
