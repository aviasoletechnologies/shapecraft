import { z } from "zod";
import type { ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";

export interface AnthropicBackendOptions {
  model?: string;
  apiKey?: string;
  maxRetries?: number;
}

export function anthropic(options: AnthropicBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "claude-sonnet-4-6";

  return {
    id: `anthropic:${modelId}`,
    guaranteeLevel: "best-effort",

    async generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T> {
      // dynamic import avoids hard dependency — user must install @anthropic-ai/sdk
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
        const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? raw);
        const result = schema.safeParse(parsed);
        if (!result.success) throw new SchemaViolationError(raw, result.error);
        return result.data as T;
      } catch (err) {
        throw new SchemaViolationError(raw, err);
      }
    },
  };
}
