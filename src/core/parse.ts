import type { SchemaInput } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { isZodSchema, isXmlInput } from "./validate.js";
import { parseXml, validateXmlOutput } from "./xml.js";

export function parseAndValidate<T>(
  raw: string,
  schema: SchemaInput<T>,
  opts: { extractJson?: boolean } = {}
): T {
  // Pattern schemas return the raw string directly — no JSON parsing
  if ("pattern" in (schema as object)) return raw as T;

  // XML schemas — parse XML then validate structure
  if (isXmlInput(schema)) {
    const arrays = "xmlTemplate" in schema ? schema.arrays : undefined;
    const parsed = parseXml(raw, arrays);
    return validateXmlOutput<T>(parsed, schema);
  }

  try {
    const text = opts.extractJson
      ? (raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? raw)
      : raw;
    const parsed = JSON.parse(text);

    if (isZodSchema(schema)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (schema as any).safeParse(parsed);
      if (!result.success) throw new SchemaViolationError(raw, result.error);
      return result.data as T;
    }

    return parsed as T;
  } catch (err) {
    if (err instanceof SchemaViolationError) throw err;
    throw new SchemaViolationError(raw, err);
  }
}
