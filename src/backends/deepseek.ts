import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";
import { isXmlInput, isGbnfInput } from "../core/validate.js";

function wantsJsonMode(schema: SchemaInput): boolean {
  // XML and GBNF output free-form strings, not JSON - DeepSeek requires the literal
  // word "json" in the prompt when json_object mode is set, same restriction as
  // Groq, so forcing it for a non-JSON schema would fight the backend, not help it.
  return !isXmlInput(schema) && !isGbnfInput(schema);
}

export interface DeepseekBackendOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

/**
 * DeepSeek - OpenAI-compatible chat completions API, reached via the `openai`
 * package pointed at DeepSeek's base URL (same dependency `openai()`/`fireworks()`/
 * `mistral()` already use, no new SDK needed). `guaranteeLevel: "native"` -
 * `response_format: { type: "json_object" }` is a real, server-side JSON-mode
 * toggle, same tier as `groq()` - but unlike `fireworks()`/`mistral()`, DeepSeek's
 * API only supports `"json_object"` (valid JSON), not `"json_schema"` (a specific
 * schema enforced server-side). No grammar mode - a `{ gbnf }` input is
 * prompt-only, best-effort, same as every other backend without one.
 *
 * Model names: `deepseek-chat`/`deepseek-reasoner` are deprecated 2026-07-24 in
 * favor of `deepseek-v4-flash` (non-thinking) / `deepseek-v4-pro` (thinking) -
 * defaults to the former.
 */
export function deepseek(options: DeepseekBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "deepseek-v4-flash";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("openai").catch(() => {
      throw new Error("Install openai: npm install openai");
    });
    const OpenAI = mod.default ?? mod;
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    // The openai package falls back to reading OPENAI_API_KEY itself when apiKey
    // is undefined (not just omitted) — passing it through unchecked would silently
    // authenticate against DeepSeek's endpoint with an unrelated OpenAI key instead
    // of failing clearly.
    if (!apiKey) throw new Error("Missing DeepSeek API key: pass { apiKey } or set DEEPSEEK_API_KEY");
    return new OpenAI({ apiKey, baseURL: options.baseURL ?? "https://api.deepseek.com" });
  }

  return {
    id: `deepseek:${modelId}`,
    guaranteeLevel: "native",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const deepseekClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await deepseekClient.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(wantsJsonMode(schema) ? { response_format: { type: "json_object" } } : {}),
        },
        callOptions?.signal ? { signal: callOptions.signal } : undefined
      );

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema, { extractJson: true });
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const deepseekClient = await client();

      const response = await deepseekClient.chat.completions.create({
        model: modelId,
        messages: [
          ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      return response.choices[0]?.message?.content ?? "";
    },

    async *generateStream<T>(
      prompt: string,
      schema: SchemaInput<T>,
      systemPrompt?: string,
      callOptions?: ModelCallOptions
    ): AsyncIterable<string> {
      const deepseekClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await deepseekClient.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(wantsJsonMode(schema) ? { response_format: { type: "json_object" } } : {}),
          stream: true,
        },
        callOptions?.signal ? { signal: callOptions.signal } : undefined
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of stream as AsyncIterable<any>) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}
