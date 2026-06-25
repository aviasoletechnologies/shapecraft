import type { SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseRawResponse } from "../core/parse.js";

export interface GeminiBackendOptions {
  model?: string;
  apiKey?: string;
}

export function gemini(options: GeminiBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "gemini-2.0-flash";

  return {
    id: `gemini:${modelId}`,
    guaranteeLevel: "best-effort",

    async generate<T>(prompt: string, schema: SchemaInput<T>): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("@google/genai").catch(() => {
        throw new Error("Install sdk: npm install @google/genai");
      });

      const GoogleGenAI = mod.GoogleGenAI ?? mod.default?.GoogleGenAI ?? mod.default;
      const client = new GoogleGenAI({
        apiKey: options.apiKey ?? process.env.GEMINI_API_KEY,
      });

      const { system, user } = buildStructuredPrompt(prompt, schema);

      const response = await client.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
          maxOutputTokens: 4096,
        },
      });

      const raw: string = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      return parseRawResponse<T>(raw, schema, { extractJson: true });
    },
  };
}
