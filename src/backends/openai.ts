import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface OpenAIBackendOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export function openai(options: OpenAIBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "gpt-4o-mini";

  return {
    id: `openai:${modelId}`,
    guaranteeLevel: "native",

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("openai").catch(() => {
        throw new Error("Install openai: npm install openai");
      });

      const OpenAI = mod.default ?? mod;
      const client = new OpenAI({
        apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
        baseURL: options.baseURL,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      // Use strict json_schema mode for Zod, non-strict for raw jsonSchema, json_object otherwise
      const responseFormat = isZodSchema(schema)
        ? {
            type: "json_schema" as const,
            json_schema: { name: "output", strict: true, schema: toJsonSchema(schema as z.ZodType<any>) },
          }
        : "jsonSchema" in (schema as object)
          ? {
              type: "json_schema" as const,
              json_schema: { name: "output", strict: false, schema: (schema as { jsonSchema: Record<string, unknown> }).jsonSchema },
            }
          : { type: "json_object" as const };

      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: responseFormat,
      });

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },
  };
}
