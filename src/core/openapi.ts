import { dereference } from "@readme/openapi-parser";
import type { JsonSchemaInput, OpenApiInput } from "../types.js";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface OperationEntry {
  requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
  responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>;
  operationId?: string;
}

function findOperation(api: Record<string, unknown>, operationId: string): OperationEntry {
  const paths = (api.paths ?? {}) as Record<string, Record<string, OperationEntry>>;
  for (const item of Object.values(paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op?.operationId === operationId) return op;
    }
  }
  throw new Error(`operationId "${operationId}" not found in OpenAPI spec`);
}

function extractSchema(op: OperationEntry, target: "requestBody" | "response"): Record<string, unknown> {
  const container =
    target === "requestBody" ? op.requestBody : (op.responses?.["200"] ?? op.responses?.["201"] ?? op.responses?.default);
  const schema = container?.content?.["application/json"]?.schema;
  if (!schema) {
    throw new Error(`Operation has no application/json ${target} schema to derive from`);
  }
  return schema;
}

/**
 * Resolves an `{ openapi }` input down to a plain `{ jsonSchema }` input,
 * ahead of the normal generate()/generateStream() pipeline - from that point
 * on it's handled identically to a hand-written jsonSchema input. Neither
 * `@readme/openapi-parser` nor its predecessor exposes an operationId->schema
 * lookup directly, so the spec's `paths` are walked by hand after
 * dereferencing (confirmed via the package's own type definitions).
 */
export async function resolveOpenApiSchema(input: OpenApiInput): Promise<JsonSchemaInput> {
  const { spec, operationId, target = "requestBody" } = input.openapi;
  const api = (await dereference(spec as never)) as unknown as Record<string, unknown>;
  const op = findOperation(api, operationId);
  return { jsonSchema: extractSchema(op, target) };
}
