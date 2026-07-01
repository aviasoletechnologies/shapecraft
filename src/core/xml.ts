import { XMLParser } from "fast-xml-parser";
import type { XmlObjectInput, XmlTemplateInput, XmlFields, XmlFieldDef } from "../types.js";
import { SchemaViolationError } from "../types.js";

// ─── Template builder (Option A → template string) ───────────────────────────

function fieldDefToXml(name: string, def: XmlFieldDef, indent: string): string {
  if (typeof def === "string") {
    return `${indent}<${name}>{${def}}</${name}>`;
  }
  if (def.type === "object") {
    const inner = fieldsToXml(def.fields, indent + "  ");
    return `${indent}<${name}>\n${inner}\n${indent}</${name}>`;
  }
  if (def.type === "array") {
    const inner = fieldsToXml(def.items, indent + "    ");
    return `${indent}<${name}>\n${indent}  <item>\n${inner}\n${indent}  </item>\n${indent}</${name}>`;
  }
  return `${indent}<${name}>{${def.type}}</${name}>`;
}

function fieldsToXml(fields: XmlFields, indent: string): string {
  return Object.entries(fields)
    .map(([name, def]) => fieldDefToXml(name, def, indent))
    .join("\n");
}

export function xmlObjectToTemplate(input: XmlObjectInput): string {
  const { root, fields } = input.xmlObject;
  const inner = fieldsToXml(fields, "  ");
  return `<${root}>\n${inner}\n</${root}>`;
}

// ─── System prompt injection ──────────────────────────────────────────────────

export function buildXmlSystemPrompt(schema: XmlObjectInput | XmlTemplateInput): string {
  const template =
    "xmlObject" in schema ? xmlObjectToTemplate(schema) : schema.xmlTemplate;
  return `Respond with valid XML exactly matching this structure. Replace placeholder values like {string}, {number}, {boolean} with actual values. No extra text, no markdown, no explanation.\n\n${template}`;
}

// ─── XML parser ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: () => false,
  parseTagValue: true,
  trimValues: true,
});

export function parseXml(raw: string, arrays?: string[]): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```xml\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    throw new SchemaViolationError(raw, `Invalid XML: ${err}`);
  }

  if (arrays && arrays.length > 0) {
    normalizeArrays(parsed, arrays);
  }

  return parsed;
}

function normalizeArrays(obj: unknown, arrayPaths: string[], currentPath = ""): void {
  if (typeof obj !== "object" || obj === null) return;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = currentPath ? `${currentPath}.${key}` : key;
    const matchedPath = arrayPaths.find((p) => p === key || p === path);

    if (matchedPath && value !== undefined && !Array.isArray(value)) {
      (obj as Record<string, unknown>)[key] = [value];
    }

    if (typeof value === "object" && value !== null) {
      normalizeArrays(value, arrayPaths, path);
    }
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function coerceField(value: unknown, type: string): unknown {
  if (type === "number") return typeof value === "number" ? value : Number(value);
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return Boolean(value);
  }
  return String(value ?? "");
}

function validateFields(obj: Record<string, unknown>, fields: XmlFields, path: string): void {
  for (const [key, def] of Object.entries(fields)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (!(key in obj)) {
      throw new Error(`Missing required field: <${fieldPath}>`);
    }

    const value = obj[key];
    const type = typeof def === "string" ? def : def.type;

    if (type === "object" && typeof def === "object" && def.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Expected object at <${fieldPath}>`);
      }
      validateFields(value as Record<string, unknown>, def.fields, fieldPath);
    } else if (type === "array" && typeof def === "object" && def.type === "array") {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (typeof item !== "object" || item === null) {
          throw new Error(`Expected object items in <${fieldPath}>`);
        }
        validateFields(item as Record<string, unknown>, def.items, fieldPath);
      }
      obj[key] = items;
    } else if (type === "string" || type === "number" || type === "boolean") {
      obj[key] = coerceField(value, type);
    }
  }
}

export function validateXmlOutput<T>(
  parsed: Record<string, unknown>,
  schema: XmlObjectInput | XmlTemplateInput
): T {
  if ("xmlObject" in schema) {
    const { root, fields } = schema.xmlObject;
    const rootValue = parsed[root];
    if (rootValue === undefined) {
      throw new SchemaViolationError(JSON.stringify(parsed), `Missing root element <${root}>`);
    }
    if (typeof rootValue !== "object" || rootValue === null) {
      throw new SchemaViolationError(JSON.stringify(parsed), `Root element <${root}> must be an object`);
    }
    try {
      validateFields(rootValue as Record<string, unknown>, fields, root);
    } catch (err) {
      throw new SchemaViolationError(JSON.stringify(parsed), err);
    }
    return rootValue as T;
  }

  // xmlTemplate — no strict field validation, return root element or full parsed object
  const keys = Object.keys(parsed);
  if (keys.length === 1) return parsed[keys[0]] as T;
  return parsed as T;
}
