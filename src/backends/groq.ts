import type { ChatMessage, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";
import { isXmlInput } from "../core/validate.js";

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

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      const groqClient = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await groqClient.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // XML schemas must not use json_object mode — Groq rejects it when prompt lacks "json"
        ...(!isXmlInput(schema) ? { response_format: { type: "json_object" } } : {}),
      });

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
  };
}
