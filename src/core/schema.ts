import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SchemaInput, ValidatorInput } from "../types.js";
import { buildXmlSystemPrompt } from "./xml.js";
import { isXmlInput, isZodSchema } from "./validate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(schema as any, { target: "openApi3" }) as Record<string, unknown>;
}

export function buildStructuredPrompt(
  prompt: string,
  schema: SchemaInput,
  systemPrompt?: string
): { system: string; user: string } {
  let schemaInfo: string;

  if (isZodSchema(schema)) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(toJsonSchema(schema), null, 2)}`;
  } else if ("jsonSchema" in schema) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(schema.jsonSchema, null, 2)}`;
  } else if ("pattern" in schema) {
    schemaInfo = `Respond with a plain string matching this pattern: ${schema.pattern}`;
  } else if (isXmlInput(schema)) {
    schemaInfo = buildXmlSystemPrompt(schema);
  } else if ("validate" in schema && (schema as ValidatorInput).hint) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify((schema as ValidatorInput).hint, null, 2)}`;
  } else {
    schemaInfo = "Respond with valid JSON. No extra text, no markdown.";
  }

  const system = systemPrompt
    ? `${systemPrompt}\n\n${schemaInfo} No extra text, no markdown, no explanation.`
    : `You are a precise assistant. ${schemaInfo} No extra text, no markdown, no explanation.`;

  return { system, user: prompt };
}
