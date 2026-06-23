import { z } from "zod";
import type { SchemaInput, ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { buildStructuredPrompt, validateOutput } from "../core/schema.js";

export interface AnthropicBackendOptions {
  model?: string;
  apiKey?: string;
}

export function anthropic(options: AnthropicBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "claude-sonnet-4-6";

  return {
    id: `anthropic:${modelId}`,
    guaranteeLevel: "best-effort",

    async generate<T>(prompt: string, schema: SchemaInput): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("@anthropic-ai/sdk").catch(() => {
        throw new Error("Install sdk: npm install @anthropic-ai/sdk");
      });

      const AnthropicClass = mod.default ?? mod;
      const client = new AnthropicClass({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema);

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      });

      const raw: string =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      try {
        return validateOutput<T>(raw, schema);
      } catch (err) {
        throw new SchemaViolationError(raw, err);
      }
    },
  };
}
