#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  discoverProjects,
  executeOperation,
  initializeProject,
  ProjectError,
  RuntimeError
} from "./index.js";
import { runMcpServer } from "./mcp.js";
import type { RuntimeRequest } from "./index.js";

export interface CliIO {
  readonly cwd?: string;
  readonly stdin?: AsyncIterable<string | Uint8Array>;
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
}

const usage =
  "Usage: justification init [directory] | justification projects <directory>... | justification run <project-root> <request.json|-> | justification mcp <project-root>...";

export async function runCli(
  argv: readonly string[],
  io: CliIO = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const [command, ...arguments_] = argv;

  try {
    if (command === "init") {
      if (arguments_.length > 1) {
        return writeError(stderr, "INVALID_REQUEST", "init accepts at most one directory");
      }

      const project = await initializeProject(arguments_[0] ?? cwd);
      stdout.write(`${JSON.stringify(project, null, 2)}\n`);
      return 0;
    }

    if (command === "projects") {
      if (arguments_.length === 0) {
        return writeError(stderr, "INVALID_REQUEST", "projects requires at least one directory");
      }

      const projects = await discoverProjects(arguments_);
      stdout.write(`${JSON.stringify({ projects }, null, 2)}\n`);
      return 0;
    }

    if (command === "run") {
      if (arguments_.length !== 2) {
        return writeError(stderr, "INVALID_REQUEST", "run requires a project root and request file (or -)");
      }

      let requestText: string;
      try {
        requestText = await readRequestText(arguments_[1], io.stdin ?? process.stdin);
      } catch (error) {
        return writeError(
          stderr,
          "INVALID_REQUEST",
          `cannot read request: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      let request: unknown;
      try {
        request = JSON.parse(requestText);
      } catch (error) {
        return writeError(
          stderr,
          "INVALID_REQUEST",
          `request is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (!isRecord(request)) {
        return writeError(stderr, "INVALID_REQUEST", "request must be a JSON object");
      }

      const response = await executeOperation(arguments_[0], request as RuntimeRequest);
      stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      return 0;
    }

    if (command === "mcp") {
      if (arguments_.length === 0) {
        return writeError(stderr, "INVALID_REQUEST", "mcp requires at least one project root");
      }

      await runMcpServer(arguments_);
      return 0;
    }

    return writeError(stderr, "INVALID_REQUEST", usage);
  } catch (error) {
    if (error instanceof ProjectError) {
      return writeError(stderr, error.code, error.message);
    }

    if (error instanceof RuntimeError || hasErrorCode(error)) {
      return writeError(stderr, error.code, error.message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return writeError(stderr, "COMMAND_FAILED", message);
  }
}

async function readRequestText(path: string, stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  if (path !== "-") {
    return readFile(path, "utf8");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(value: unknown): value is { code: string; message: string } {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function writeError(
  stderr: { write(chunk: string): void },
  code: string,
  message: string
): number {
  stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  return 1;
}

const invokedFile = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
const moduleFile = realpathSync(fileURLToPath(import.meta.url));
if (invokedFile === moduleFile) {
  runCli(process.argv.slice(2)).then((status) => {
    process.exitCode = status;
  });
}
