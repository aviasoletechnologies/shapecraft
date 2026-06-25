import type { SchemaInput } from "../types.js";
import { SchemaViolationError } from "../types.js";

export function parseRawResponse<T>(
  raw: string,
  schema: SchemaInput<T>,
  opts: { extractJson?: boolean } = {}
): T {
  if ("pattern" in (schema as object)) return raw as T;

  try {
    const text = opts.extractJson
      ? (raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? raw)
      : raw;
    return JSON.parse(text) as T;
  } catch (err) {
    throw new SchemaViolationError(raw, err);
  }
}
