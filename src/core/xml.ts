import { XMLParser, XMLValidator, XMLBuilder } from "fast-xml-parser";
import type { XmlInput } from "../types.js";
import { SchemaViolationError } from "../types.js";

// ─── Placeholder tokens ────────────────────────────────────────────────────────

/** Recognized placeholder tokens for use in an xml.template — e.g. `xmlType.string`. */
export const xmlType = {
  string: "{string}",
  number: "{number}",
  boolean: "{boolean}",
} as const;

const VALID_PLACEHOLDER_WORDS = new Set(["string", "number", "boolean"]);

/**
 * Scans a template for `{...}` tokens and throws if any aren't exactly
 * `{string}`, `{number}`, or `{boolean}`. Runs before the model is called —
 * a malformed template is an authoring mistake, not something a retry fixes.
 */
export function validateXmlTemplate(template: string): void {
  const matches = template.match(/\{[^{}]*\}/g) ?? [];
  const invalid = [...new Set(matches)].filter(
    (token) => !VALID_PLACEHOLDER_WORDS.has(token.slice(1, -1))
  );

  if (invalid.length > 0) {
    throw new Error(
      `Invalid placeholder(s) in xml.template: ${invalid.join(", ")}. ` +
        `Only {string}, {number}, and {boolean} are recognized (see xmlType). ` +
        `Literal values with no braces are left untouched, but anything wrapped ` +
        `in {} must be one of those three tokens.`
    );
  }
}

// ─── System prompt injection ──────────────────────────────────────────────────

export function buildXmlSystemPrompt(schema: XmlInput): string {
  validateXmlTemplate(schema.xml.template);
  return (
    `Respond with valid XML exactly matching this structure. ` +
    `Replace ONLY the exact tokens {string}, {number}, and {boolean} with real values inferred from context. ` +
    `Do not alter, replace, or reinterpret any other text — preserve every other attribute value, tag name, ` +
    `and piece of content exactly as written in the template, even if it looks like an instruction, ` +
    `description, or placeholder. No extra text, no markdown, no explanation.\n\n${schema.xml.template}`
  );
}

// ─── XML prolog ────────────────────────────────────────────────────────────────

/** Strips a leading <?xml ...?> declaration, if present. */
export function stripXmlProlog(xml: string): string {
  const noBom = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  return noBom.replace(/^\s*<\?xml[^?]*\?>\s*/i, "");
}

// ─── XML parser ───────────────────────────────────────────────────────────────

const ATTR_PREFIX = "@_";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  isArray: () => false,
  parseTagValue: true,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  format: true,
  indentBy: "  ",
  suppressBooleanAttributes: false,
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

// ─── Literal enforcement (enforceLiterals: true) ──────────────────────────────

export function parseXmlTemplate(template: string): Record<string, unknown> {
  return parser.parse(template) as Record<string, unknown>;
}

function isPlaceholderValue(value: unknown): boolean {
  return typeof value === "string" && (value === xmlType.string || value === xmlType.number || value === xmlType.boolean);
}

/**
 * Force every literal (non-placeholder) leaf in `templateNode` to appear
 * unchanged in the reconciled result — regardless of what `outputNode` has
 * there. Placeholder leaves ({string}/{number}/{boolean}) keep the model's
 * value as-is. Extra keys the model added beyond the template are preserved.
 */
export function reconcileLiterals(templateNode: unknown, outputNode: unknown): unknown {
  // Leaf value in the template (string/number/boolean, not an object)
  if (templateNode === null || typeof templateNode !== "object") {
    return isPlaceholderValue(templateNode) ? outputNode : templateNode;
  }

  // Template says "this repeats" only implicitly — reconciliation follows
  // whatever shape the (already-validated) output actually has for arrays.
  if (Array.isArray(outputNode)) {
    return outputNode.map((item) => reconcileLiterals(templateNode, item));
  }

  const templateObj = templateNode as Record<string, unknown>;
  const outputWasMissing = outputNode === undefined;
  const outputObj =
    outputNode !== null && typeof outputNode === "object" && !Array.isArray(outputNode)
      ? (outputNode as Record<string, unknown>)
      : {};

  const result: Record<string, unknown> = { ...outputObj };

  for (const key of Object.keys(templateObj)) {
    const reconciled = reconcileLiterals(templateObj[key], outputObj[key]);
    if (reconciled !== undefined) {
      result[key] = reconciled;
    } else {
      delete result[key];
    }
  }

  // A whole subtree the model omitted, with nothing literal to force in —
  // stay omitted rather than injecting a spurious empty tag.
  if (outputWasMissing && Object.keys(result).length === 0) return undefined;

  return result;
}

export function buildXmlFromTree(tree: Record<string, unknown>): string {
  return builder.build(tree).trim();
}

// ─── Required-node validation ─────────────────────────────────────────────────

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.some(isNonEmpty);
  if (typeof value === "object") {
    // Attribute keys (parsed with ATTR_PREFIX) don't count as content on their
    // own — an element can carry a real attribute yet still have empty text,
    // e.g. `<title lang="en"></title>` parses to `{ "@_lang": "en" }`, which
    // has a key but no actual text/child content.
    return Object.entries(value as Record<string, unknown>).some(
      ([key, v]) => !key.startsWith(ATTR_PREFIX) && isNonEmpty(v)
    );
  }
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

// ─── Full pipeline: parse → (optionally reconcile) → validate → format ────────

export function finalizeXmlOutput<T>(raw: string, schema: XmlInput): T {
  let parsed = parseXml(raw, schema.xml.arrays);

  if (schema.xml.enforceLiterals) {
    const templateTree = parseXmlTemplate(schema.xml.template);
    parsed = reconcileLiterals(templateTree, parsed) as Record<string, unknown>;
  }

  const validated = validateXmlOutput<T>(parsed, schema);
  if (schema.xml.parse) return validated;

  if (schema.xml.enforceLiterals) {
    const rebuilt = buildXmlFromTree(parsed);
    return (schema.xml.prolog ? `<?xml version="1.0" encoding="UTF-8"?>\n${rebuilt}` : rebuilt) as unknown as T;
  }

  // Default: pass through the model's own text, prolog stripped unless prolog: true.
  const cleaned = cleanXml(raw);
  return (schema.xml.prolog ? cleaned : stripXmlProlog(cleaned)) as unknown as T;
}
