import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { XmlInput } from "../types.js";
import { SchemaViolationError } from "../types.js";

// ─── System prompt injection ──────────────────────────────────────────────────

export function buildXmlSystemPrompt(schema: XmlInput): string {
  return `Respond with valid XML exactly matching this structure. Replace placeholder values like {string}, {number}, {boolean} with actual values. No extra text, no markdown, no explanation.\n\n${schema.xml.template}`;
}

// ─── XML parser ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: () => false,
  parseTagValue: true,
  trimValues: true,
});

export function cleanXml(raw: string): string {
  return raw.trim().replace(/^```xml\s*/i, "").replace(/```\s*$/, "").trim();
}

export function parseXml(raw: string, arrays?: string[]): Record<string, unknown> {
  const cleaned = cleanXml(raw);

  // Opt-in debug: set SHAPECRAFT_DEBUG_XML=1 to log the raw model output.
  if (process.env.SHAPECRAFT_DEBUG_XML) {
    console.error("[shapecraft:xml] raw model output:\n" + raw);
  }

  // fast-xml-parser's parser is lenient, so validate well-formedness explicitly.
  const valid = XMLValidator.validate(cleaned);
  if (valid !== true) {
    throw new SchemaViolationError(raw, `Invalid XML: ${valid.err?.msg ?? "malformed"}`);
  }

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

// ─── Required-node validation ─────────────────────────────────────────────────

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.some(isNonEmpty);
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true; // numbers, booleans
}

/** True if `name` exists anywhere in the tree with a non-empty value. */
function deepHasNonEmpty(obj: unknown, name: string): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === name && isNonEmpty(value)) return true;
    if (deepHasNonEmpty(value, name)) return true;
  }
  return false;
}

// ─── Output validation ────────────────────────────────────────────────────────

export function validateXmlOutput<T>(parsed: Record<string, unknown>, schema: XmlInput): T {
  const { required } = schema.xml;

  if (required && required.length > 0) {
    for (const name of required) {
      if (!deepHasNonEmpty(parsed, name)) {
        throw new SchemaViolationError(
          JSON.stringify(parsed),
          `Missing or empty required node: <${name}>`
        );
      }
    }
  }

  // Unwrap the single root element for the parse: true path.
  const keys = Object.keys(parsed);
  if (keys.length === 1) return parsed[keys[0]] as T;
  return parsed as T;
}
