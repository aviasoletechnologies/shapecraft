import { z } from "zod";
import type { JsonSchemaValidator, SchemaInput, XmlInput } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { finalizeXmlOutput, isNonEmpty } from "./xml.js";

// Duck-typed rather than `instanceof z.ZodType`: a `file:`-linked or
// nested-install consumer can end up with a different zod module instance
// (or major version) than the one this schema was built with, which makes
// `instanceof` false even for a genuine Zod schema. `_def`/`parse`/`safeParse`
// are present on every ZodType across zod v3 and v4, and none of the other
// SchemaInput shapes (jsonSchema/pattern/validate/xml) have all three.
export function isZodSchema(schema: SchemaInput): schema is z.ZodType<any> {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "_def" in schema &&
    typeof (schema as { parse?: unknown }).parse === "function" &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  );
}

export function isXmlInput(schema: SchemaInput): schema is XmlInput {
  return typeof schema === "object" && schema !== null && "xml" in schema;
}

function nullToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(nullToUndefined);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, nullToUndefined(v)])
    );
  }
  return value;
}

export function checkJsonSchema(value: unknown, schema: Record<string, unknown>): void {
  const type = schema.type as string | undefined;

  if (type) {
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (actual !== type) {
      throw new Error(`Expected type "${type}", got "${actual}"`);
    }
  }

  if (schema.enum) {
    if (!(schema.enum as unknown[]).includes(value)) {
      throw new Error(`Value not in enum: ${JSON.stringify(value)}`);
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    const required = (schema.required as string[]) ?? [];
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    for (const key of required) {
      if (!(key in obj)) throw new Error(`Missing required property: "${key}"`);
      // "required" means present AND non-empty — same as the XML path. Stops a
      // constrained grammar from satisfying a required field with "" / [] / {}
      // when the source had no value for it.
      if (!isNonEmpty(obj[key])) throw new Error(`Required property is empty: "${key}"`);
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj) checkJsonSchema(obj[key], propSchema);
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (const item of value) {
      checkJsonSchema(item, schema.items as Record<string, unknown>);
    }
  }
}

export function validateOutput<T>(
  output: unknown,
  schema: SchemaInput<T>,
  opts: { jsonSchemaValidator?: JsonSchemaValidator | undefined } = {}
): T {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(nullToUndefined(output));
    if (!result.success) throw new SchemaViolationError(JSON.stringify(output), result.error);
    return result.data;
  }

  if ("jsonSchema" in schema) {
    try {
      const validate = opts.jsonSchemaValidator ?? checkJsonSchema;
      validate(output, schema.jsonSchema);
    } catch (err) {
      throw new SchemaViolationError(JSON.stringify(output), err);
    }
    return output as T;
  }

  if ("pattern" in schema) {
    const str = typeof output === "string" ? output : JSON.stringify(output);
    if (!schema.pattern.test(str)) {
      throw new SchemaViolationError(str, `Output does not match pattern ${schema.pattern}`);
    }
    return output as T;
  }

  if ("validate" in schema) {
    if (!schema.validate(output)) {
      throw new SchemaViolationError(JSON.stringify(output), "Custom validator returned false");
    }
    return output as T;
  }

  if (isXmlInput(schema)) {
    if (typeof output === "string") {
      // raw XML string (from mock models, or the default string path) — validate now
      return finalizeXmlOutput<T>(output, schema);
    }
    // already parsed by a real backend — pass through
    return output as T;
  }

  throw new Error("Unknown schema type");
}
