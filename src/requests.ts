import { NODE_KINDS, RELATIONSHIP_TYPES } from "./domain.ts";

import * as z from "zod/v4";

const applicabilitySchema = z
  .object({
    subject: z.string().optional(),
    version: z.string().optional(),
    validFrom: instantSchema(),
    validUntil: instantSchema()
  })
  .strict();

const actorSchema = z.string().min(1);
const atSchema = instantSchema();
const expectedRevisionSchema = z.number().int().nonnegative().optional();

/**
 * These are the fields callers may provide when recording a node. Provenance
 * and acceptance metadata are created by the runtime and therefore are not
 * part of this request shape.
 */
const recordFieldsSchema = z
  .object({
    propositionKey: z.string().optional(),
    accepted: z.boolean().optional(),
    locator: z.string().optional(),
    digest: z.string().optional(),
    consideredOptions: z.array(z.string()).optional(),
    selectedOption: z.string().optional(),
    rationale: z.string().optional()
  })
  .strict();

const recordSchema = z
  .object({
    id: z.string().min(1).optional(),
    kb: z.string().min(1),
    kind: z.enum(NODE_KINDS),
    title: z.string().min(1),
    body: z.string().optional(),
    basis: z.array(z.string().min(1)).min(1).optional(),
    basisGroups: z.array(z.array(z.string().min(1)).min(1)).min(1).optional(),
    fields: recordFieldsSchema.optional(),
    links: z
      .array(
        z
          .object({
            to: z.string().min(1),
            type: z.enum(RELATIONSHIP_TYPES),
            rationale: z.string().optional()
          })
          .strict()
      )
      .min(1)
      .optional(),
    applicability: applicabilitySchema.optional(),
    actor: actorSchema,
    at: atSchema,
    expectedRevision: expectedRevisionSchema
  })
  .strict()
  .superRefine((request, context) => {
    if (request.basis !== undefined && request.basisGroups !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["basis", "basisGroups"],
        message: "provide either basis or basisGroups, not both"
      });
    }
    if (request.kind !== "decision" && request.kind !== "artifact" && (request.basis !== undefined || request.basisGroups !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message: "basis is only valid for decision or artifact records; use justify to add support"
      });
    }
  });

export const operationRequestSchemas = {
  knowledge_bases: z
    .object({ kb: z.string().min(1).optional() })
    .strict(),
  create_kb: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1),
      parent: z.string().min(1).optional(),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  record: recordSchema,
  justify: z
    .object({
      conclusion: z.string().min(1),
      groups: z
        .array(
          z.union([
            z.array(z.string().min(1)).min(1),
            z.object({ premises: z.array(z.string().min(1)).min(1) }).strict()
          ])
        )
        .min(1),
      rationale: z.string().min(1),
      kb: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      applicability: applicabilitySchema.optional(),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  relate: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
      type: z.enum(RELATIONSHIP_TYPES),
      kb: z.string().min(1).optional(),
      rationale: z.string().optional(),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  capture_source: z
    .object({
      locator: z.string().min(1),
      kb: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      sourceId: z.string().min(1).optional(),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  inspect_source: z
    .object({
      sourceId: z.string().min(1).optional(),
      locator: z.string().min(1).optional(),
      kb: z.string().min(1).optional()
    })
    .strict(),
  evidence: z
    .object({
      evidenceId: z.string().min(1).optional(),
      sourceId: z.string().min(1).optional(),
      kb: z.string().min(1).optional()
    })
    .strict(),
  why: z
    .object({
      nodeId: z.string().min(1),
      kb: z.string().min(1).optional(),
      revision: z.number().int().nonnegative().optional(),
      evaluationTime: atSchema
    })
    .strict(),
  impact: z
    .object({
      nodeId: z.string().min(1),
      kb: z.string().min(1).optional(),
      evaluationTime: atSchema
    })
    .strict(),
  trace: z
    .object({
      nodeId: z.string().min(1),
      direction: z.enum(["upstream", "downstream"]).optional(),
      kb: z.string().min(1).optional(),
      budget: z.number().int().positive().optional(),
      evaluationTime: atSchema
    })
    .strict(),
  refresh: z
    .object({
      sourceIds: z.array(z.string().min(1)).min(1).optional(),
      kb: z.string().min(1).optional(),
      evaluationTime: atSchema,
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  changed: z
    .object({
      sourceId: z.string().min(1).optional(),
      kb: z.string().min(1).optional()
    })
    .strict(),
  context: z
    .object({
      nodeId: z.string().min(1).optional(),
      query: z.string().optional(),
      kb: z.string().min(1).optional(),
      budget: z.number().int().positive().optional(),
      evaluationTime: atSchema
    })
    .strict(),
  search: z
    .object({
      query: z.string().min(1),
      kb: z.string().min(1).optional(),
      budget: z.number().int().positive().optional()
    })
    .strict(),
  contradict: z
    .object({
      left: z.string().min(1),
      right: z.string().min(1),
      rationale: z.string().min(1),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  conflicts: z
    .object({ kb: z.string().min(1).optional() })
    .strict(),
  review: z
    .object({
      reviewId: z.string().min(1).optional(),
      status: z.enum(["open", "closed"]).optional(),
      rationale: z.string().optional(),
      kb: z.string().min(1).optional(),
      actor: actorSchema.optional(),
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  promote: z
    .object({
      nodeId: z.string().min(1),
      reason: z.string().optional(),
      conflicts: z.array(z.string().min(1)).min(1).optional(),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  resolve_conflict: z
    .object({
      contradictionId: z.string().min(1),
      resolution: z.enum(["supersession", "different_scope", "different_time", "source_error", "unresolved"]),
      rationale: z.string().min(1),
      actor: actorSchema,
      at: atSchema,
      expectedRevision: expectedRevisionSchema
    })
    .strict(),
  audit: z
    .object({ kb: z.string().min(1).optional(), evaluationTime: atSchema })
    .strict(),
  rebuild: z
    .object({ actor: actorSchema.optional(), at: atSchema, expectedRevision: expectedRevisionSchema })
    .strict(),
  export: z
    .object({
      kb: z.string().min(1).optional(),
      outputDir: z.string().min(1).optional(),
      repair: z.boolean().optional()
    })
    .strict()
} as const;

export type OperationName = keyof typeof operationRequestSchemas;

export class RequestValidationError extends Error {
  readonly name = "RequestValidationError";
  readonly code = "INVALID_REQUEST" as const;
  readonly details: { readonly issues: readonly z.core.$ZodIssue[] };

  constructor(message: string, issues: readonly z.core.$ZodIssue[]) {
    super(message);
    this.details = { issues };
  }
}

export function validateRuntimeRequest(request: unknown): void {
  if (!isRecord(request) || typeof request.op !== "string") return;
  const schema = operationRequestSchemas[request.op as OperationName];
  if (schema === undefined) return;
  const { op: _operation, ...requestFields } = request;
  const parsed = schema.safeParse(requestFields);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const path = issue?.path.length === 0 ? "request" : issue?.path.join(".") || "request";
  const message = issue === undefined ? "request is invalid" : `${path}: ${issue.message}`;
  throw new RequestValidationError(message, parsed.error.issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instantSchema(): z.ZodOptional<z.ZodString> {
  return z.string().refine(isOffsetBearingInstant, {
    message: "must be a valid offset-bearing ISO timestamp with a real calendar date"
  }).optional();
}

function isOffsetBearingInstant(value: string): boolean {
  if (value.trim().length === 0 || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (match === null) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}
