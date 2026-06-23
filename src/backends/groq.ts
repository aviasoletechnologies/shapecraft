import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { SchemaViolationError, isRegexInput } from "../types.js";
import { buildStructuredPrompt, validateOutput } from "../core/schema.js";

export interface GroqBackendOptions {
  model?: string;
  apiKey?: string;
}

export function groq(options: GroqBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "llama-3.3-70b-versatile";

  return {
    id: `groq:${modelId}`,
    guaranteeLevel: "native",

    async generate<T>(prompt: string, schema: SchemaInput): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("groq-sdk").catch(() => {
        throw new Error("Install groq: npm install groq-sdk");
      });

      const Groq = mod.default ?? mod;
      const client = new Groq({
        apiKey: options.apiKey ?? process.env.GROQ_API_KEY,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema);

      const requestBody: Record<string, unknown> = {
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };

      // Groq JSON mode only for non-regex schemas
      if (!isRegexInput(schema)) {
        requestBody.response_format = { type: "json_object" };
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
