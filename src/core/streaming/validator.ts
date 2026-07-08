import { z } from "zod";
import type { JsonSchemaValidator, SchemaInput } from "../../types.js";
import { checkJsonSchema, isXmlInput, isZodSchema } from "../validate.js";

/**
 * Validator stage (incremental half): validates one field's value against
 * its own sub-schema, if the root schema decomposes into named fields (Zod
 * object, or jsonSchema with `properties`). Returns an error message on
 * failure, or null if the field passed (or there's no sub-schema for it / for
 * this schema type at all - XML, pattern, and custom-validator schemas never
 * decompose). The final whole-buffer check reuses the shared
 * `parseAndValidate()` in `../parse.js` - that stage applies once per
 * attempt, this one applies once per completed field.
 */
export function validateFieldIfPossible<T>(
  schema: SchemaInput<T>,
  key: string,
  value: unknown,
  opts: { jsonSchemaValidator?: JsonSchemaValidator | undefined } = {}
): string | null {
  if (isXmlInput(schema)) return null;

  if (isZodSchema(schema)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = (schema as any).shape as Record<string, z.ZodTypeAny> | undefined;
    const fieldSchema = shape?.[key];
    if (!fieldSchema) return null;
    const result = fieldSchema.safeParse(value);
    return result.success ? null : `Field "${key}" failed schema validation: ${result.error.message}`;
  }

  if ("jsonSchema" in (schema as object)) {
    const properties = (schema as { jsonSchema: Record<string, unknown> }).jsonSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const propSchema = properties?.[key];
    if (!propSchema) return null;
    try {
      const validate = opts.jsonSchemaValidator ?? checkJsonSchema;
      validate(value, propSchema);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  return null; // pattern / custom validator schemas - no per-field decomposition
}
