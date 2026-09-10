import { discoverProjects } from "./index.js";
import { executeOperation } from "./runtime.js";
import type { ProjectDescriptor } from "./index.js";
import type { RuntimeRequest } from "./runtime.js";
import { operationRequestSchemas, type OperationName } from "./requests.js";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const projectIdSchema = z.string().min(1);

function withProject(schema: z.ZodObject<any>): z.ZodObject<any> {
  return schema.extend({ project_id: projectIdSchema }).strict();
}

const requestSchemas = Object.fromEntries(
  (Object.keys(operationRequestSchemas) as OperationName[]).map(operation => [
    operation,
    withProject(operationRequestSchemas[operation])
  ])
) as Record<OperationName, z.ZodObject<any>>;

const responseSchema = z.union([
  z.object({ revision: z.number().int().nonnegative(), data: z.unknown() }).strict(),
  z
    .object({
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          retryable: z.boolean(),
          details: z.record(z.string(), z.unknown()).optional()
        })
        .strict()
    })
    .strict()
]);

const projectDescriptorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    root: z.string(),
    sharedKnowledgeBase: z.object({ id: z.literal("shared"), root: z.string() }).strict()
  })
  .strict();

const projectsResponseSchema = z.object({ projects: z.array(projectDescriptorSchema) }).strict();

export class McpConfigurationError extends Error {
  readonly code = "MCP_CONFIGURATION" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConfigurationError";
  }
}

function ensureUniqueProjects(projects: readonly ProjectDescriptor[]): ProjectDescriptor[] {
  const byId = new Map<string, ProjectDescriptor>();
  for (const project of projects) {
    if (byId.has(project.id)) {
      throw new McpConfigurationError(`multiple configured roots have project id ${project.id}`);
    }
    byId.set(project.id, project);
  }
  return [...byId.values()];
}

export async function discoverConfiguredProjects(
  roots: readonly string[]
): Promise<ProjectDescriptor[]> {
  if (roots.length === 0) {
    throw new McpConfigurationError("mcp requires at least one project root");
  }
  const projects = await discoverProjects(roots);
  if (projects.length !== roots.length) {
    throw new McpConfigurationError("every configured MCP root must be an initialized project");
  }
  return ensureUniqueProjects(projects);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorPayload(error: unknown): {
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
} {
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
    const message = typeof error.message === "string" ? error.message : String(error);
    const details = isRecord(error.details) ? error.details : undefined;
    return {
      error: {
        code,
        message,
        retryable: code === "BUSY" || code === "CONCURRENT_WRITE" || code === "PROVIDER_UNAVAILABLE",
        ...(details === undefined ? {} : { details })
      }
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      retryable: false
    }
  };
}

function toolError(error: unknown) {
  const structuredContent = errorPayload(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function projectNotConfigured(projectId: unknown) {
  return toolError({
    code: "PROJECT_NOT_CONFIGURED",
    message: `project_id is not configured for this server: ${String(projectId)}`
  });
}

function operationToolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result
  };
}

export function createMcpServer(projects: readonly ProjectDescriptor[]): McpServer {
  const configured = ensureUniqueProjects(projects);
  const byId = new Map(configured.map(project => [project.id, project]));
  const server = new McpServer({ name: "justification", version: "0.1.0" });

  server.registerTool(
    "projects",
    {
      title: "List configured projects",
      description: "List the project roots explicitly configured for this server.",
      inputSchema: z.object({}).strict(),
      outputSchema: projectsResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false }
    },
    async () => operationToolResult({ projects: configured })
  );

  for (const operation of Object.keys(requestSchemas) as OperationName[]) {
    const inputSchema = requestSchemas[operation];
    server.registerTool(
      operation,
      {
        title: `Run ${operation}`,
        description: `Run the ${operation} operation for an explicitly selected project.`,
        inputSchema,
        outputSchema: responseSchema,
        ...(new Set([
          "knowledge_bases",
          "inspect_source",
          "evidence",
          "why",
          "impact",
          "trace",
          "changed",
          "context",
          "search",
          "conflicts",
          "audit"
        ]).has(operation)
          ? { annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false } }
          : {})
      },
      async (rawArguments) => {
        const arguments_ = rawArguments as Record<string, unknown>;
        const projectId = arguments_.project_id;
        const project = byId.get(typeof projectId === "string" ? projectId : "");
        if (project === undefined) {
          return projectNotConfigured(projectId);
        }

        const { project_id: _projectId, ...requestFields } = arguments_;
        const request = { op: operation, ...requestFields } as RuntimeRequest;
        try {
          return operationToolResult(await executeOperation(project.root, request));
        } catch (error) {
          return toolError(error);
        }
      }
    );
  }

  return server;
}

export async function startMcpServer(roots: readonly string[]): Promise<StdioServerHandle> {
  const projects = await discoverConfiguredProjects(roots);
  return serveStdio(() => createMcpServer(projects), {
    onerror: error => {
      process.stderr.write(`[mcp] ${error.message}\n`);
    }
  });
}

export async function runMcpServer(roots: readonly string[]): Promise<void> {
  const handle = await startMcpServer(roots);
  await new Promise<void>(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      process.stdin.off("end", finish);
      process.stdin.off("close", finish);
      resolve();
    };
    process.stdin.once("end", finish);
    process.stdin.once("close", finish);
  });
  await handle.close();
}
