import { z } from "zod";
import { SchemaViolationError } from "../types.js";

export function parseAndValidate<T>(
  raw: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>,
  opts: { extractJson?: boolean } = {}
): T {
  try {
    const text = opts.extractJson
      ? (raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? raw)
      : raw;
    const parsed = JSON.parse(text);
    const result = schema.safeParse(parsed);
    if (!result.success) throw new SchemaViolationError(raw, result.error);
    return result.data as T;
  } catch (err) {
    if (err instanceof SchemaViolationError) throw err;
    throw new SchemaViolationError(raw, err);
  }
}
