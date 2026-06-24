import { z } from "zod";
import type { ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";

export interface GeminiBackendOptions {
  model?: string;
  apiKey?: string;
}

export function gemini(options: GeminiBackendOptions = {}): ShapecraftModel {
  const modelId = options.model ?? "gemini-2.0-flash";

  return {
    id: `gemini:${modelId}`,
    guaranteeLevel: "best-effort",

    async generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T> {
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