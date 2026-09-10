import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const PROJECT_METADATA_FILE = "justification.json";
const PROJECT_FORMAT = "justification.project";
const PROJECT_VERSION = 1;
const SHARED_KB_ID = "shared" as const;

export type ProjectErrorCode =
  | "MALFORMED_METADATA"
  | "UNSUPPORTED_METADATA"
  | "INVALID_STRUCTURE"
  | "INVALID_ROOT";

export class ProjectError extends Error {
  readonly name = "ProjectError";
  readonly code: ProjectErrorCode;
  readonly root: string;

  constructor(
    code: ProjectErrorCode,
    message: string,
    root: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
    this.root = root;
  }
}

interface ProjectMetadata {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: typeof PROJECT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly sharedKb: typeof SHARED_KB_ID;
}

export interface ProjectDescriptor {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly sharedKnowledgeBase: {
    readonly id: "shared";
    readonly root: string;
  };
}

function descriptor(root: string, metadata: ProjectMetadata): ProjectDescriptor {
  return {
    id: metadata.id,
    name: metadata.name,
    root,
    sharedKnowledgeBase: {
      id: SHARED_KB_ID,
      root: join(root, "kb", SHARED_KB_ID)
    }
  };
}

async function readProjectMetadata(root: string): Promise<ProjectMetadata | undefined> {
  const metadataPath = join(root, PROJECT_METADATA_FILE);
  try {
    await lstat(metadataPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  let contents: string;

  try {
    contents = await readFile(metadataPath, "utf8");
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "EISDIR" || error.code === "ENOENT")
    ) {
      throw new ProjectError(
        "MALFORMED_METADATA",
        `${PROJECT_METADATA_FILE} must be a readable JSON file`,
        root,
        { cause: error }
      );
    }

    throw error;
  }

  try {
    return parseProjectMetadata(JSON.parse(contents), root);
  } catch (error) {
    if (error instanceof ProjectError) {
      throw error;
    }

    throw new ProjectError(
      "MALFORMED_METADATA",
      `${PROJECT_METADATA_FILE} contains invalid JSON`,
      root,
      { cause: error }
    );
  }
}

async function validateSharedKnowledgeBase(root: string): Promise<void> {
  const sharedRoot = join(root, "kb", SHARED_KB_ID);

  try {
    if (!(await stat(sharedRoot)).isDirectory()) {
      throw new ProjectError(
        "INVALID_STRUCTURE",
        `${sharedRoot} must be a directory`,
        root
      );
    }
  } catch (error) {
    if (error instanceof ProjectError) {
      throw error;
    }

    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new ProjectError(
        "INVALID_STRUCTURE",
        `initialized project is missing ${join("kb", SHARED_KB_ID)}`,
        root,
        { cause: error }
      );
    }

    throw error;
  }
}

async function createSharedKnowledgeBase(root: string): Promise<void> {
  try {
    await mkdir(join(root, "kb", SHARED_KB_ID), { recursive: true });
  } catch (error) {
    if (isNodeError(error) && (error.code === "EEXIST" || error.code === "ENOTDIR")) {
      throw new ProjectError(
        "INVALID_STRUCTURE",
        `cannot create ${join("kb", SHARED_KB_ID)} because an existing path is not a directory`,
        root,
        { cause: error }
      );
    }

    throw error;
  }
}

function parseProjectMetadata(value: unknown, root: string): ProjectMetadata {
  if (!isRecord(value)) {
    throw new ProjectError(
      "MALFORMED_METADATA",
      `${PROJECT_METADATA_FILE} must contain a project object`,
      root
    );
  }

  if (value.format !== PROJECT_FORMAT || value.version !== PROJECT_VERSION) {
    if (value.format === PROJECT_FORMAT && typeof value.version === "number") {
      throw new ProjectError(
        "UNSUPPORTED_METADATA",
        `${PROJECT_METADATA_FILE} uses unsupported version ${String(value.version)}`,
        root
      );
    }

    if (typeof value.format === "string" && typeof value.version === "number") {
      throw new ProjectError(
        "UNSUPPORTED_METADATA",
        `${PROJECT_METADATA_FILE} uses unsupported format ${value.format}`,
        root
      );
    }

    throw new ProjectError(
      "MALFORMED_METADATA",
      `${PROJECT_METADATA_FILE} is missing its format or version`,
      root
    );
  }

  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.sharedKb !== SHARED_KB_ID
  ) {
    throw new ProjectError(
      "MALFORMED_METADATA",
      `${PROJECT_METADATA_FILE} has invalid project fields`,
      root
    );
  }

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: value.id,
    name: value.name,
    sharedKb: SHARED_KB_ID
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function canonicalExistingRoot(inputRoot: string): Promise<string> {
  if (typeof inputRoot !== "string" || inputRoot.trim().length === 0) {
    throw new ProjectError("INVALID_ROOT", "project root must be a nonempty path", inputRoot);
  }

  let root: string;
  try {
    root = await realpath(inputRoot);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new ProjectError("INVALID_ROOT", `project root does not exist: ${inputRoot}`, inputRoot, {
        cause: error
      });
    }

    throw error;
  }

  try {
    if (!(await stat(root)).isDirectory()) {
      throw new ProjectError("INVALID_ROOT", `project root is not a directory: ${inputRoot}`, root);
    }
  } catch (error) {
    if (error instanceof ProjectError) {
      throw error;
    }

    throw error;
  }

  return root;
}

export async function initializeProject(inputRoot: string): Promise<ProjectDescriptor> {
  if (typeof inputRoot !== "string" || inputRoot.trim().length === 0) {
    throw new ProjectError("INVALID_ROOT", "project root must be a nonempty path", inputRoot);
  }

  try {
    await mkdir(inputRoot, { recursive: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new ProjectError("INVALID_ROOT", `project root is not a directory: ${inputRoot}`, inputRoot, {
        cause: error
      });
    }

    throw error;
  }

  const root = await canonicalExistingRoot(inputRoot);
  const existing = await readProjectMetadata(root);

  if (existing !== undefined) {
    await validateSharedKnowledgeBase(root);
    return descriptor(root, existing);
  }

  await createSharedKnowledgeBase(root);

  const metadata: ProjectMetadata = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: randomUUID(),
    name: basename(root).trim().length === 0 ? "Untitled project" : basename(root),
    sharedKb: SHARED_KB_ID
  };
  await writeFile(
    join(root, PROJECT_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );

  return descriptor(root, metadata);
}

export async function discoverProjects(roots: readonly string[]): Promise<ProjectDescriptor[]> {
  const projects: ProjectDescriptor[] = [];

  for (const inputRoot of roots) {
    const root = await canonicalExistingRoot(inputRoot);
    const metadata = await readProjectMetadata(root);
    if (metadata !== undefined) {
      await validateSharedKnowledgeBase(root);
      projects.push(descriptor(root, metadata));
    }
  }

  return projects;
}
