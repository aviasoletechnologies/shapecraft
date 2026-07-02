import { z } from "zod";
import type { SchemaInput, XmlInput } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { finalizeXmlOutput } from "./xml.js";

export function isZodSchema(schema: SchemaInput): schema is z.ZodType<any> {
  return schema instanceof z.ZodType;
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

function checkJsonSchema(value: unknown, schema: Record<string, unknown>): void {
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

export function validateOutput<T>(output: unknown, schema: SchemaInput<T>): T {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(nullToUndefined(output));
    if (!result.success) throw new SchemaViolationError(JSON.stringify(output), result.error);
    return result.data;
  }

  if ("jsonSchema" in schema) {
    try {
      checkJsonSchema(output, schema.jsonSchema);
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
