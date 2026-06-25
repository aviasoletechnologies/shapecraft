import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SchemaInput } from "../types.js";

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

  if (schema instanceof z.ZodType) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(toJsonSchema(schema), null, 2)}`;
  } else if ("jsonSchema" in schema) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(schema.jsonSchema, null, 2)}`;
  } else if ("pattern" in schema) {
    schemaInfo = `Respond with a plain string matching this pattern: ${schema.pattern}`;
  } else {
    schemaInfo = "Respond with valid output as required.";
  }

  const system =
    systemPrompt ??
    `You are a precise assistant. ${schemaInfo} No extra text, no markdown, no explanation.`;

  return { system, user: prompt };
}
