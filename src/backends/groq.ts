import { z } from "zod";
import type { ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";

export interface GroqBackendOptions {
  model?: string;
  apiKey?: string;
}

export function groq(options: GroqBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "llama-3.3-70b-versatile";

  return {
    id: `groq:${modelId}`,
    guaranteeLevel: "native",

    async generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("groq-sdk").catch(() => {
        throw new Error("Install groq: npm install groq-sdk");
      });

      const Groq = mod.default ?? mod;
      const client = new Groq({
        apiKey: options.apiKey ?? process.env.GROQ_API_KEY,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema);

      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      });

      const raw: string = response.choices[0]?.message?.content ?? "";

      try {
        const parsed = JSON.parse(raw);
        const result = schema.safeParse(parsed);
        if (!result.success) throw new SchemaViolationError(raw, result.error);
        return result.data as T;
      } catch (err) {
        throw new SchemaViolationError(raw, err);
      }
    },
  };
}
