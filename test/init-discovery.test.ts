import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { discoverProjects, initializeProject } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test("initializing an empty project makes its shared knowledge base discoverable", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-init-"));

  try {
    const initialized = await initializeProject(root);
    const canonicalRoot = await realpath(root);
    const discovered = await discoverProjects([root]);

    assert.equal(discovered.length, 1);
    assert.deepEqual(discovered[0], {
      id: initialized.id,
      name: basename(canonicalRoot),
      root: canonicalRoot,
      sharedKnowledgeBase: {
        id: "shared",
        root: join(canonicalRoot, "kb", "shared")
      }
    });
    assert.equal((await stat(join(canonicalRoot, "kb", "shared"))).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reinitializing a project preserves its identity, descriptor and shared content", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-repeat-"));

  try {
    const first = await initializeProject(root);
    const metadataPath = join(first.root, "justification.json");
    const metadataBefore = await readFile(metadataPath, "utf8");
    const markerPath = join(first.sharedKnowledgeBase.root, "existing-note.txt");
    await writeFile(markerPath, "keep this project knowledge", "utf8");

    const second = await initializeProject(root);

    assert.deepEqual(second, first);
    assert.equal(await readFile(markerPath, "utf8"), "keep this project knowledge");
    assert.equal(await readFile(metadataPath, "utf8"), metadataBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery inspects only the explicitly supplied project roots", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-scope-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");

  try {
    const first = await initializeProject(firstRoot);
    await initializeProject(secondRoot);

    const discovered = await discoverProjects([firstRoot]);

    assert.deepEqual(discovered, [first]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the CLI initializes an explicitly supplied directory and emits JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-cli-init-"));
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    const result = await execFile(process.execPath, [cli, "init", root], {
      encoding: "utf8"
    });
    const output = JSON.parse(result.stdout) as {
      id: string;
      root: string;
      sharedKnowledgeBase: { id: string; root: string };
    };

    assert.equal(typeof output.id, "string");
    assert.equal(output.root, await realpath(root));
    assert.equal(output.sharedKnowledgeBase.id, "shared");
    assert.equal(output.sharedKnowledgeBase.root, join(output.root, "kb", "shared"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI discovers only the directories supplied to projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-cli-projects-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    const first = await initializeProject(firstRoot);
    await initializeProject(secondRoot);

    const result = await execFile(process.execPath, [cli, "projects", firstRoot], {
      encoding: "utf8"
    });
    const output = JSON.parse(result.stdout) as { projects: unknown[] };

    assert.deepEqual(output.projects, [first]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the CLI returns JSON and a nonzero status for an invalid request", async () => {
  const cli = join(process.cwd(), "dist", "cli.js");

  await assert.rejects(
    execFile(process.execPath, [cli, "projects"], { encoding: "utf8" }),
    (error: unknown) => {
      const result = error as { code?: number; stderr?: string };
      assert.equal(result.code, 1);
      assert.deepEqual(JSON.parse(result.stderr ?? ""), {
        error: {
          code: "INVALID_REQUEST",
          message: "projects requires at least one directory"
        }
      });
      return true;
    }
  );
});

test("discovery reports an explicitly supplied root that does not exist", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-missing-root-"));
  const missingRoot = join(parent, "does-not-exist");

  try {
    await assert.rejects(
      discoverProjects([missingRoot]),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_ROOT");
        return true;
      }
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("initialization reports malformed existing project metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-malformed-"));

  try {
    await writeFile(join(root, "justification.json"), "{ this is not JSON\n", "utf8");

    await assert.rejects(
      initializeProject(root),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "MALFORMED_METADATA");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initialization reports unsupported project metadata versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-unsupported-"));

  try {
    await writeFile(
      join(root, "justification.json"),
      JSON.stringify({
        format: "justification.project",
        version: 2,
        id: "project-1",
        name: "example",
        sharedKb: "shared"
      }),
      "utf8"
    );

    await assert.rejects(
      initializeProject(root),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "UNSUPPORTED_METADATA");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initialization rejects a project descriptor whose shared knowledge base is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-missing-shared-"));

  try {
    await writeFile(
      join(root, "justification.json"),
      JSON.stringify({
        format: "justification.project",
        version: 1,
        id: "project-1",
        name: "example",
        sharedKb: "shared"
      }),
      "utf8"
    );

    await assert.rejects(
      initializeProject(root),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_STRUCTURE");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initialization reports a broken shared knowledge base path", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-broken-shared-"));

  try {
    await mkdir(join(root, "kb"), { recursive: true });
    await writeFile(join(root, "kb", "shared"), "this must be a directory", "utf8");

    await assert.rejects(
      initializeProject(root),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_STRUCTURE");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
