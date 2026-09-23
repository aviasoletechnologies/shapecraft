import { isNonEmpty } from "./xml.js";

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
