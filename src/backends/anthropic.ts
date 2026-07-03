import type { ChatMessage, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";

export interface AnthropicBackendOptions {
  model?: string;
  apiKey?: string;
}

export function anthropic(options: AnthropicBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "claude-sonnet-4-6";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@anthropic-ai/sdk").catch(() => {
      throw new Error("Install sdk: npm install @anthropic-ai/sdk");
    });
    const AnthropicClass = mod.default ?? mod;
    return new AnthropicClass({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  return {
    id: `anthropic:${modelId}`,
    guaranteeLevel: "best-effort",

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      const anthropicClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await anthropicClient.messages.create({
        model: modelId,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      });

      const raw: string =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      return parseAndValidate<T>(raw, schema, { extractJson: true });
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const anthropicClient = await client();

      const response = await anthropicClient.messages.create({
        model: modelId,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      return response.content[0]?.type === "text" ? response.content[0].text : "";
    },
  };
}
