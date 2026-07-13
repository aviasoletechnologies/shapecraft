import { z } from "zod";
import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema, isGbnfInput } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface FireworksBackendOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function responseFormatFor(schema: SchemaInput): any {
  // Fireworks' grammar mode applies a GBNF grammar as a genuine token-level
  // constraint (not the prompt-only best-effort path other cloud backends fall
  // back to for gbnf) - see https://docs.fireworks.ai/structured-responses/structured-output-grammar-based
  if (isGbnfInput(schema)) return { type: "grammar", grammar: schema.gbnf };
  return isZodSchema(schema)
    ? {
        type: "json_schema" as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json_schema: { name: "output", schema: toJsonSchema(schema as z.ZodType<any>) },
      }
    : "jsonSchema" in (schema as object)
      ? {
          type: "json_schema" as const,
          json_schema: { name: "output", schema: (schema as { jsonSchema: Record<string, unknown> }).jsonSchema },
        }
      : { type: "json_object" as const };
}

/**
 * Fireworks AI - OpenAI-compatible chat completions API, reached via the `openai`
 * package pointed at Fireworks' base URL (same dependency `openai()` already uses,
 * no new SDK needed). The differentiator over `openai()`/`groq()` is grammar mode:
 * a `{ gbnf }` input gets `response_format: { type: "grammar", grammar }`, a real
 * token-level constraint, not a prompted-and-checked best-effort string.
 */
export function fireworks(options: FireworksBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "accounts/fireworks/models/llama-v3p1-70b-instruct";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("openai").catch(() => {
      throw new Error("Install openai: npm install openai");
    });
    const OpenAI = mod.default ?? mod;
    return new OpenAI({
      apiKey: options.apiKey ?? process.env.FIREWORKS_API_KEY,
      baseURL: options.baseURL ?? "https://api.fireworks.ai/inference/v1",
    });
  }

  return {
    id: `fireworks:${modelId}`,
    guaranteeLevel: "native",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const fireworksClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await fireworksClient.chat.completions.create(
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

      return parseAndValidate<T>(raw, schema);
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const fireworksClient = await client();

      const response = await fireworksClient.chat.completions.create({
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
      const fireworksClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await fireworksClient.chat.completions.create(
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
