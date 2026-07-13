import { z } from "zod";
import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema, isGbnfInput } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface MistralBackendOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function responseFormatFor(schema: SchemaInput): any {
  // Mistral has no grammar mode (unlike fireworks()) - a gbnf input is prompt-only,
  // best-effort, same as openai()/groq(). Forcing json_schema mode here would fight
  // the grammar's free-form string output.
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
 * Mistral AI - OpenAI-compatible chat completions API, reached via the `openai`
 * package pointed at Mistral's base URL (same dependency `openai()`/`fireworks()`
 * already use, no new SDK needed). `guaranteeLevel: "native"` - `response_format:
 * { type: "json_schema", ... }` is a server-side enforced schema, same tier as
 * `openai()`/`groq()`/`fireworks()`.
 */
export function mistral(options: MistralBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "mistral-large-latest";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("openai").catch(() => {
      throw new Error("Install openai: npm install openai");
    });
    const OpenAI = mod.default ?? mod;
    return new OpenAI({
      apiKey: options.apiKey ?? process.env.MISTRAL_API_KEY,
      baseURL: options.baseURL ?? "https://api.mistral.ai/v1",
    });
  }

  return {
    id: `mistral:${modelId}`,
    guaranteeLevel: "native",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const mistralClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await mistralClient.chat.completions.create(
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

      // Mistral sometimes wraps `json_schema`-mode output in a ```json fence despite
      // response_format supposedly enforcing raw JSON - extractJson is a safe no-op
      // when it doesn't (same pattern anthropic() uses for the same reason).
      return parseAndValidate<T>(raw, schema, { extractJson: true });
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const mistralClient = await client();

      const response = await mistralClient.chat.completions.create({
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
      const mistralClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await mistralClient.chat.completions.create(
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
