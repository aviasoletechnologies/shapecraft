import { z } from "zod";
import type { ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";

export interface OllamaBackendOptions {
  model: string;
  host?: string;
}

export function ollama(options: OllamaBackendOptions): ShapecraftModel {
  const host = options.host ?? "http://localhost:11434";

  return {
    id: `ollama:${options.model}`,
    guaranteeLevel: "constrained",

    async generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T> {
      const { system, user } = buildStructuredPrompt(prompt, schema);
      const jsonSchema = toJsonSchema(schema);

      const response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          format: jsonSchema,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as { message?: { content?: string } };
      const raw = json.message?.content ?? "";

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
