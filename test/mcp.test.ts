import { strict as assert } from "node:assert";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { initializeProject } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test("the MCP stdio server lists every explicitly configured project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "justification-mcp-projects-"));
  const firstRoot = join(parent, "first");
  const secondRoot = join(parent, "second");
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    const first = await initializeProject(firstRoot);
    const second = await initializeProject(secondRoot);
    const client = new Client(
      { name: "mcp-test-client", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } }
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", firstRoot, secondRoot],
      stderr: "pipe"
    });

    await client.connect(transport);
    assert.equal(client.getProtocolEra(), "modern");
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");

    const listedTools = await client.listTools();
    assert.equal(listedTools.tools.some((tool) => tool.name === "projects"), true);
    assert.equal(listedTools.tools.some((tool) => tool.name === "knowledge_bases"), true);
    assert.equal(listedTools.tools.some((tool) => tool.name === "record"), true);

    const projects = await client.callTool({ name: "projects", arguments: {} });
    assert.equal(projects.isError, undefined);
    assert.deepEqual(projects.structuredContent, {
      projects: [first, second]
    });

    const knowledgeBases = await client.callTool({
      name: "knowledge_bases",
      arguments: { project_id: first.id }
    });
    assert.equal(knowledgeBases.isError, undefined);
    const knowledgeBasePayload = knowledgeBases.structuredContent as {
      revision: number;
      data: { project: { id: string }; knowledgeBases: Array<{ id: string }> };
    };
    assert.equal(knowledgeBasePayload.revision, 0);
    assert.equal(knowledgeBasePayload.data.project.id, first.id);
    assert.deepEqual(knowledgeBasePayload.data.knowledgeBases.map((kb) => kb.id), ["shared"]);

    const created = await client.callTool({
      name: "create_kb",
      arguments: {
        project_id: first.id,
        id: "review",
        title: "Review KB",
        actor: "mcp-test"
      }
    });
    assert.equal(created.isError, undefined);
    const createdPayload = created.structuredContent as {
      revision: number;
      data: {
        knowledgeBase: {
          id: string;
          title: string;
          parent: string | null;
          createdBy: string;
          createdAt: string;
          inherited: boolean;
          root: string;
        };
      };
    };
    assert.equal(createdPayload.revision, 1);
    assert.deepEqual(createdPayload.data.knowledgeBase, {
      id: "review",
      title: "Review KB",
      parent: "shared",
      createdBy: "mcp-test",
      createdAt: createdPayload.data.knowledgeBase.createdAt,
      inherited: false,
      root: join(first.root, "kb", "review")
    });

    await client.close();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("MCP returns a structured scope error before dispatching an unknown project", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-mcp-scope-"));
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    await initializeProject(root);
    const client = new Client(
      { name: "mcp-test-client", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } }
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", root],
      stderr: "pipe"
    });

    await client.connect(transport);
    const result = await client.callTool({
      name: "knowledge_bases",
      arguments: { project_id: "not-configured" }
    });

    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      error: {
        code: "PROJECT_NOT_CONFIGURED",
        message: "project_id is not configured for this server: not-configured",
        retryable: false
      }
    });
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI run command reports malformed JSON on stderr", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-cli-run-invalid-"));
  const requestPath = join(root, "request.json");
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    await initializeProject(root);
    await writeFile(requestPath, "{ not valid json\n", "utf8");

    await assert.rejects(
      execFile(process.execPath, [cli, "run", root, requestPath], { encoding: "utf8" }),
      (error: unknown) => {
        const result = error as { code?: number; stderr?: string };
        assert.equal(result.code, 1);
        const parsed = JSON.parse(result.stderr ?? "") as { error: { code: string; message: string } };
        assert.equal(parsed.error.code, "INVALID_REQUEST");
        assert.match(parsed.error.message, /^request is not valid JSON:/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI run command dispatches a valid operation and emits its JSON response", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-cli-run-valid-"));
  const requestPath = join(root, "request.json");
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    const project = await initializeProject(root);
    await writeFile(requestPath, JSON.stringify({ op: "knowledge_bases" }), "utf8");

    const result = await execFile(process.execPath, [cli, "run", root, requestPath], {
      encoding: "utf8"
    });
    const response = JSON.parse(result.stdout) as {
      revision: number;
      data: { project: { id: string }; knowledgeBases: Array<{ id: string }> };
    };
    assert.equal(response.revision, 0);
    assert.equal(response.data.project.id, project.id);
    assert.deepEqual(response.data.knowledgeBases.map((kb) => kb.id), ["shared"]);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI run command reports an unreadable request file as invalid input", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-cli-run-missing-"));
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    await initializeProject(root);
    await assert.rejects(
      execFile(process.execPath, [cli, "run", root, join(root, "missing.json")], { encoding: "utf8" }),
      (error: unknown) => {
        const result = error as { code?: number; stderr?: string };
        assert.equal(result.code, 1);
        const parsed = JSON.parse(result.stderr ?? "") as { error: { code: string; message: string } };
        assert.equal(parsed.error.code, "INVALID_REQUEST");
        assert.match(parsed.error.message, /^cannot read request:/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI mcp command requires at least one root", async () => {
  const cli = join(process.cwd(), "dist", "cli.js");

  await assert.rejects(
    execFile(process.execPath, [cli, "mcp"], { encoding: "utf8" }),
    (error: unknown) => {
      const result = error as { code?: number; stderr?: string };
      assert.equal(result.code, 1);
      assert.deepEqual(JSON.parse(result.stderr ?? ""), {
        error: {
          code: "INVALID_REQUEST",
          message: "mcp requires at least one project root"
        }
      });
      return true;
    }
  );
});

test("the CLI mcp command rejects an uninitialized project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "justification-cli-mcp-uninitialized-"));
  const cli = join(process.cwd(), "dist", "cli.js");

  try {
    await assert.rejects(
      execFile(process.execPath, [cli, "mcp", root], { encoding: "utf8" }),
      (error: unknown) => {
        const result = error as { code?: number; stderr?: string };
        assert.equal(result.code, 1);
        assert.deepEqual(JSON.parse(result.stderr ?? ""), {
          error: {
            code: "MCP_CONFIGURATION",
            message: "every configured MCP root must be an initialized project"
          }
        });
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
