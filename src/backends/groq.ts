import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";
import { isXmlInput, isGbnfInput } from "../core/validate.js";

function wantsJsonMode(schema: SchemaInput): boolean {
  // XML and GBNF output free-form strings, not JSON — Groq rejects json_object
  // mode when the prompt doesn't literally contain the word "json".
  return !isXmlInput(schema) && !isGbnfInput(schema);
}

export interface GroqBackendOptions {
  model?: string;
  apiKey?: string;
}

export function groq(options: GroqBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "llama-3.3-70b-versatile";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("groq-sdk").catch(() => {
      throw new Error("Install groq: npm install groq-sdk");
    });
    const Groq = mod.default ?? mod;
    return new Groq({ apiKey: options.apiKey ?? process.env.GROQ_API_KEY });
  }

  return {
    id: `groq:${modelId}`,
    guaranteeLevel: "native",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const groqClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await groqClient.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // XML and GBNF schemas must not use json_object mode — Groq rejects it when prompt lacks "json"
          ...(wantsJsonMode(schema) ? { response_format: { type: "json_object" } } : {}),
        },
        callOptions?.signal ? { signal: callOptions.signal } : undefined
      );

      const raw: string = response.choices[0]?.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const groqClient = await client();

      const response = await groqClient.chat.completions.create({
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
      const groqClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await groqClient.chat.completions.create(
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
