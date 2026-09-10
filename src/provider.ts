import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { sha256 } from "./domain.ts";
import type { SourceAvailability } from "./domain.ts";

export type ProviderErrorCode = "INVALID_LOCATOR" | "PROVIDER_UNAVAILABLE" | "UNSUPPORTED_CONTENT";

export class ProviderError extends Error {
  readonly name = "ProviderError";
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export type ProviderCapabilities = {
  readonly resolve: true;
  readonly fetch: true;
  readonly version: true;
  readonly validate: true;
};

export type ResolvedFile = {
  readonly providerId: "file";
  readonly locator: string;
  readonly absolutePath: string;
};

export type ProviderFetch = {
  readonly status: SourceAvailability;
  readonly locator: string;
  readonly providerRevision?: string;
  readonly digest?: string;
  readonly bytesDigest?: string;
  readonly text?: string;
  readonly contentType?: string;
  readonly diagnostics?: string;
};

export interface KnowledgeProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  resolve(locator: string): Promise<ResolvedFile>;
  fetch(resolved: ResolvedFile): Promise<ProviderFetch>;
  version(resolved: ResolvedFile): Promise<string | undefined>;
  validate(locator: string): Promise<void>;
}

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MANAGED_PATHS = new Set([".justification", "justification-history", "kb", "justification.json"]);

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function normalizedLocator(locator: string): string {
  const candidate = locator.replaceAll("\\", "/");
  if (candidate.length === 0 || candidate.startsWith("/") || isAbsolute(locator)) {
    throw new ProviderError("INVALID_LOCATOR", "file provider locators must be nonempty project-relative paths");
  }
  const normalized = normalize(candidate).replaceAll("\\", "/");
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) {
    throw new ProviderError("INVALID_LOCATOR", "file provider locator escapes the project root");
  }
  const first = normalized.split("/")[0];
  if (MANAGED_PATHS.has(first)) throw new ProviderError("INVALID_LOCATOR", `source path is inside managed runtime state: ${first}`);
  return normalized;
}

export class FileKnowledgeProvider implements KnowledgeProvider {
  readonly id = "file" as const;
  readonly capabilities: ProviderCapabilities = { resolve: true, fetch: true, version: true, validate: true };

  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async validate(locator: string): Promise<void> {
    await this.resolve(locator);
  }

  async resolve(locator: string): Promise<ResolvedFile> {
    const normalized = normalizedLocator(locator);
    const candidate = join(this.root, normalized);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { providerId: "file", locator: normalized, absolutePath: candidate };
      }
      throw new ProviderError("PROVIDER_UNAVAILABLE", `cannot resolve source ${normalized}`, { cause: error });
    }
    if (!isContained(this.root, canonical)) {
      throw new ProviderError("INVALID_LOCATOR", `source symlink escapes the project root: ${normalized}`);
    }
    const first = relative(this.root, canonical).split(sep)[0];
    if (MANAGED_PATHS.has(first)) throw new ProviderError("INVALID_LOCATOR", `source path is inside managed runtime state: ${first}`);
    let info;
    try {
      info = await stat(canonical);
    } catch (error) {
      throw new ProviderError("PROVIDER_UNAVAILABLE", `cannot inspect source ${normalized}`, { cause: error });
    }
    if (!info.isFile()) throw new ProviderError("INVALID_LOCATOR", `source locator is not a regular file: ${normalized}`);
    return { providerId: "file", locator: normalized, absolutePath: canonical };
  }

  async version(resolved: ResolvedFile): Promise<string | undefined> {
    try {
      const info = await stat(resolved.absolutePath);
      return `${info.size}:${info.mtimeMs}`;
    } catch {
      return undefined;
    }
  }

  async fetch(resolved: ResolvedFile): Promise<ProviderFetch> {
    let bytes: Buffer;
    try {
      bytes = await readFile(resolved.absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { status: "missing", locator: resolved.locator, diagnostics: "source file does not exist" };
      }
      if (code === "EACCES" || code === "EPERM") {
        return { status: "denied", locator: resolved.locator, diagnostics: "source file access was denied" };
      }
      return { status: "unavailable", locator: resolved.locator, diagnostics: error instanceof Error ? error.message : String(error) };
    }
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      return { status: "unavailable", locator: resolved.locator, diagnostics: `source exceeds ${MAX_SOURCE_BYTES} bytes` };
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      return { status: "unavailable", locator: resolved.locator, diagnostics: "source is not valid UTF-8" };
    }
    if (text.includes("\u0000")) {
      return { status: "unavailable", locator: resolved.locator, diagnostics: "binary source content is not supported" };
    }
    const digest = sha256(text);
    const bytesDigest = sha256(bytes);
    const revision = await this.version(resolved);
    return {
      status: "present",
      locator: resolved.locator,
      providerRevision: revision ?? bytesDigest,
      digest,
      bytesDigest,
      text,
      contentType: "text/plain; charset=utf-8"
    };
  }
}
