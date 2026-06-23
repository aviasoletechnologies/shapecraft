import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { SchemaViolationError, isZodSchema, isJsonSchemaInput, isRegexInput } from "../types.js";
import { resolveJsonSchema, buildStructuredPrompt, validateOutput } from "../core/schema.js";

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

    async generate<T>(prompt: string, schema: SchemaInput): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("openai").catch(() => {
        throw new Error("Install openai: npm install openai");
      });

      const OpenAI = mod.default ?? mod;
      const client = new OpenAI({
        apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
        baseURL: options.baseURL,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema);

      // Use strict JSON schema mode only when schema is resolvable to JSON schema
      const jsonSchema = resolveJsonSchema(schema);
      const useStrictMode = !isRegexInput(schema) && jsonSchema !== null;

      const requestBody: Record<string, unknown> = {
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };

      if (useStrictMode) {
        requestBody.response_format = {
          type: "json_schema",
          json_schema: { name: "output", strict: true, schema: jsonSchema },
        };
      }

      const response = await client.chat.completions.create(requestBody);
      const raw: string = response.choices[0]?.message?.content ?? "";

      try {
        return validateOutput<T>(raw, schema);
      } catch (err) {
        throw new SchemaViolationError(raw, err);
      }
    },
  };
}
