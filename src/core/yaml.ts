import { parse as parseYamlText } from "yaml";
import type { YamlInput } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { checkJsonSchema } from "./jsonSchemaCheck.js";

export function buildYamlSystemPrompt(schema: YamlInput): string {
  return (
    `Respond with valid YAML matching this JSON Schema exactly:\n\n` +
    `${JSON.stringify(schema.yaml.schema, null, 2)}\n\n` +
    `Output only the YAML document — no markdown code fences, no extra text, no explanation.`
  );
}

// Models often wrap YAML in a ```yaml / ``` markdown fence despite being told
// not to — strip it rather than let it fail parsing and burn a retry.
function stripYamlFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:ya?ml)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

export function finalizeYamlOutput<T>(raw: string, schema: YamlInput): T {
  const cleaned = stripYamlFence(raw);

  let parsed: unknown;
  try {
    parsed = parseYamlText(cleaned);
  } catch (err) {
    throw new SchemaViolationError(raw, err);
  }

  try {
    checkJsonSchema(parsed, schema.yaml.schema);
  } catch (err) {
    throw new SchemaViolationError(raw, err);
  }

  return (schema.yaml.parse === false ? cleaned : parsed) as T;
}
