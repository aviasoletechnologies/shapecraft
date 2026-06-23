import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { SchemaViolationError, isRegexInput } from "../types.js";
import { resolveJsonSchema, buildStructuredPrompt, validateOutput } from "../core/schema.js";

export interface OllamaBackendOptions {
  model: string;
  host?: string;
}

export function ollama(options: OllamaBackendOptions): ShapecraftModel {
  const host = options.host ?? "http://localhost:11434";

  return {
    id: `ollama:${options.model}`,
    guaranteeLevel: "constrained",

    async generate<T>(prompt: string, schema: SchemaInput): Promise<T> {
      const { system, user } = buildStructuredPrompt(prompt, schema);
      const jsonSchema = resolveJsonSchema(schema);

      const body: Record<string, unknown> = {
        model: options.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
      };

      // Ollama supports JSON schema grammar constraint for non-regex schemas
      if (!isRegexInput(schema) && jsonSchema !== null) {
        body.format = jsonSchema;
      }

      const response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as { message?: { content?: string } };
      const raw = json.message?.content ?? "";

      try {
        return validateOutput<T>(raw, schema);
      } catch (err) {
        throw new SchemaViolationError(raw, err);
      }
    },
  };
}
