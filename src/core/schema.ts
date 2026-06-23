import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  type SchemaInput,
  isZodSchema,
  isJsonSchemaInput,
  isRegexInput,
  isCustomValidatorInput,
} from "../types.js";

export function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  return zodToJsonSchema(schema as any, { target: "openApi3" }) as Record<string, unknown>;
}

/** Resolve any SchemaInput to a JSON schema object for prompting (best-effort) */
export function resolveJsonSchema(schema: SchemaInput): Record<string, unknown> | null {
  if (isZodSchema(schema)) return toJsonSchema(schema);
  if (isJsonSchemaInput(schema)) return schema.jsonSchema;
  if (isCustomValidatorInput(schema)) return schema.hint ?? null;
  if (isRegexInput(schema)) {
    const pat = schema.pattern instanceof RegExp ? schema.pattern.source : schema.pattern;
    return { type: "string", pattern: pat };
  }
  return null;
}

/** Validate raw output against SchemaInput. Returns parsed value or throws. */
export function validateOutput<T>(raw: string, schema: SchemaInput): T {
  if (isRegexInput(schema)) {
    const pat = schema.pattern instanceof RegExp ? schema.pattern : new RegExp(schema.pattern);
    if (!pat.test(raw.trim())) {
      throw new Error(`Output does not match pattern /${pat.source}/`);
    }
    return raw.trim() as unknown as T;
  }

  // For JSON-based schemas, parse JSON first
  const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  const jsonStr = jsonMatch?.[0] ?? raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Output is not valid JSON: ${raw}`);
  }

  if (isZodSchema(schema)) {
    const result = schema.safeParse(parsed);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    return result.data as T;
  }

  if (isJsonSchemaInput(schema)) {
    // No deep validation — trust model + JSON parse is sufficient
    return parsed as T;
  }

  if (isCustomValidatorInput(schema)) {
    if (!schema.validate(parsed)) {
      throw new Error("Custom validator returned false");
    }
    return parsed as T;
  }

  throw new Error("Unknown schema type");
}

export function buildStructuredPrompt(
  prompt: string,
  schema: SchemaInput,
  systemPrompt?: string
): { system: string; user: string } {
  const jsonSchema = resolveJsonSchema(schema);

  let schemaBlock = "";
  if (isRegexInput(schema)) {
    const pat = schema.pattern instanceof RegExp ? schema.pattern.source : schema.pattern;
    schemaBlock = `You must return a plain string matching this regex pattern: /${pat}/\nNo JSON, no quotes, no extra text.`;
  } else if (jsonSchema) {
    schemaBlock = `You must respond with valid JSON matching this schema exactly. No extra text, no markdown.\n\nSchema:\n${JSON.stringify(jsonSchema, null, 2)}`;
  } else {
    schemaBlock = "Respond with valid JSON. No extra text, no markdown.";
  }

  const system = systemPrompt ?? `You are a precise assistant. ${schemaBlock}`;
  return { system, user: prompt };
}
