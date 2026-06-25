import { z } from "zod";
import type { ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
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

    async generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T> {
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
      const jsonSchema = toJsonSchema(schema);

      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "output",
            strict: true,
            schema: jsonSchema,
          },
        },
      });

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },
  };
}
