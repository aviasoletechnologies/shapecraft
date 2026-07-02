import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface OllamaBackendOptions {
  model: string;
  host?: string;
  timeoutMs?: number;
}

export function ollama(options: OllamaBackendOptions): ShapecraftModel {
  const host = options.host ?? "http://localhost:11434";
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    id: `ollama:${options.model}`,
    guaranteeLevel: "constrained",

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      // Pass JSON schema to Ollama's format param for constrained decoding when possible
      let format: unknown = undefined;
      if (isZodSchema(schema)) {
        format = toJsonSchema(schema as z.ZodType<any>);
      } else if ("jsonSchema" in (schema as object)) {
        format = (schema as { jsonSchema: Record<string, unknown> }).jsonSchema;
      }

      const response = await fetch(`${host}/api/chat`, {
        signal: AbortSignal.timeout(timeoutMs),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(format ? { format } : {}),
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as { message?: { content?: string } };
      const raw = json.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },
  };
}
