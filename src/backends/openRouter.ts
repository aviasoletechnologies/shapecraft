import { z } from "zod";
import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema, isGbnfInput } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface OpenRouterBackendOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function responseFormatFor(schema: SchemaInput): any {
  // No grammar mode - OpenRouter is pass-through across many different underlying
  // providers, so there's no single grammar API to target. A gbnf input is
  // prompt-only, best-effort, same as openai()/groq()/mistral().
  if (isGbnfInput(schema)) return undefined;
  return isZodSchema(schema)
    ? {
        type: "json_schema" as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json_schema: { name: "output", strict: true, schema: toJsonSchema(schema as z.ZodType<any>) },
      }
    : "jsonSchema" in (schema as object)
      ? {
          type: "json_schema" as const,
          json_schema: { name: "output", strict: false, schema: (schema as { jsonSchema: Record<string, unknown> }).jsonSchema },
        }
      : { type: "json_object" as const };
}

/**
 * OpenRouter - OpenAI-compatible chat completions API, reached via the `openai`
 * package pointed at OpenRouter's base URL (same dependency `openai()`/`fireworks()`/
 * `mistral()` already use, no new SDK needed). `guaranteeLevel: "best-effort"`,
 * deliberately not `"native"` like the other cloud backends - OpenRouter is
 * pass-through across many different underlying providers/models, and
 * `response_format: { type: "json_schema" }` enforcement isn't guaranteed for every
 * model it can route to, only the ones that actually support it themselves. Defensively
 * requests `extractJson: true` on every call for the same reason `anthropic()` needs
 * it - an arbitrary underlying model may wrap output in a markdown fence regardless of
 * what `response_format` asked for.
 */
export function openRouter(options: OpenRouterBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "openai/gpt-4o-mini";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("openai").catch(() => {
      throw new Error("Install openai: npm install openai");
    });
    const OpenAI = mod.default ?? mod;
    return new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: options.baseURL ?? "https://openrouter.ai/api/v1",
    });
  }

  return {
    id: `openrouter:${modelId}`,
    guaranteeLevel: "best-effort",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const openRouterClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await openRouterClient.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: responseFormatFor(schema),
        },
        callOptions?.signal ? { signal: callOptions.signal } : undefined
      );

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema, { extractJson: true });
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const openRouterClient = await client();

      const response = await openRouterClient.chat.completions.create({
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
      const openRouterClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await openRouterClient.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: responseFormatFor(schema),
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
