import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(schema as any, { target: "openApi3" }) as Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStructuredPrompt(
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>,
  systemPrompt?: string
): { system: string; user: string } {
  const jsonSchema = JSON.stringify(toJsonSchema(schema), null, 2);
  const system =
    systemPrompt ??
    `You are a precise assistant. Always respond with valid JSON matching the schema exactly. No extra text, no markdown, no explanation.

Schema:
${jsonSchema}`;

  return { system, user: prompt };
}
