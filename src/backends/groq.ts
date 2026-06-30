import type { SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";

export interface GroqBackendOptions {
  model?: string;
  apiKey?: string;
}

export function groq(options: GroqBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "llama-3.3-70b-versatile";

  return {
    id: `groq:${modelId}`,
    guaranteeLevel: "native",

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("groq-sdk").catch(() => {
        throw new Error("Install groq: npm install groq-sdk");
      });

      const Groq = mod.default ?? mod;
      const client = new Groq({
        apiKey: options.apiKey ?? process.env.GROQ_API_KEY,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      });

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },
  };
}
