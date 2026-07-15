import { z } from "zod";
import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema, isGbnfInput } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";

export interface GeminiBackendOptions {
  model?: string;
  apiKey?: string;
}

interface ResponseConfig {
  responseMimeType?: "application/json";
  responseJsonSchema?: unknown;
}

function responseConfigFor(schema: SchemaInput): ResponseConfig {
  // Gemini has no grammar mode (unlike fireworks()/llamaCpp()) - a gbnf input is
  // prompt-only, best-effort, same as every other backend without one.
  if (isGbnfInput(schema)) return {};

  if (isZodSchema(schema)) {
    // responseJsonSchema accepts standard JSON Schema (zodToJsonSchema output)
    // directly - unlike the older responseSchema field, which needs Gemini's own
    // Type-enum-based OpenAPI-subset shape instead of plain JSON Schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { responseMimeType: "application/json", responseJsonSchema: toJsonSchema(schema as z.ZodType<any>) };
  }

  if ("jsonSchema" in (schema as object)) {
    return {
      responseMimeType: "application/json",
      responseJsonSchema: (schema as { jsonSchema: Record<string, unknown> }).jsonSchema,
    };
  }

  return { responseMimeType: "application/json" };
}

/**
 * Google Gemini via the official `@google/genai` SDK - not the OpenAI-compatible
 * endpoint, since that's a migration bridge for OpenAI users rather than Gemini's
 * primary integration path, and doesn't expose `responseJsonSchema` (plain JSON
 * Schema) vs. the older `responseSchema` (Gemini's own Type-enum OpenAPI subset).
 * `guaranteeLevel: "native"` - `responseJsonSchema`/`responseMimeType` is server-side
 * constrained decoding, the same tier as `openai()`/`groq()`/`fireworks()`/`mistral()`.
 */
export function gemini(options: GeminiBackendOptions = {}): ShapecraftModel {
  // "gemini-2.5-flash" 404s for new-user accounts ("no longer available to new
  // users") despite still being listed by models.list() - confirmed live. The
  // "-latest" alias tracks whatever Google currently recommends instead of a
  // version string that can get deprecated out from under a hardcoded default.
  const modelId = options.model ?? "gemini-flash-latest";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function client(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@google/genai").catch(() => {
      throw new Error("Install @google/genai: npm install @google/genai");
    });
    const { GoogleGenAI } = mod;
    return new GoogleGenAI({ apiKey: options.apiKey ?? process.env.GEMINI_API_KEY });
  }

  return {
    id: `gemini:${modelId}`,
    guaranteeLevel: "native",
    capabilities: { streaming: true, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const ai = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const response = await ai.models.generateContent({
        model: modelId,
        contents: user,
        config: {
          systemInstruction: system,
          ...responseConfigFor(schema),
          ...(callOptions?.signal ? { abortSignal: callOptions.signal } : {}),
        },
      });

      const raw: string = response.text ?? "";

      // extractJson is a defensive no-op if Gemini never wraps output in a markdown
      // fence - kept for the same reason mistral()/openRouter() keep it: cheap
      // insurance against a provider-side formatting quirk breaking every call.
      return parseAndValidate<T>(raw, schema, { extractJson: true });
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const ai = await client();

      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const response = await ai.models.generateContent({
        model: modelId,
        contents,
        config: systemPrompt ? { systemInstruction: systemPrompt } : undefined,
      });

      return response.text ?? "";
    },

    async *generateStream<T>(
      prompt: string,
      schema: SchemaInput<T>,
      systemPrompt?: string,
      callOptions?: ModelCallOptions
    ): AsyncIterable<string> {
      const ai = await client();
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);

      const stream = await ai.models.generateContentStream({
        model: modelId,
        contents: user,
        config: {
          systemInstruction: system,
          ...responseConfigFor(schema),
          ...(callOptions?.signal ? { abortSignal: callOptions.signal } : {}),
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of stream as AsyncIterable<any>) {
        const delta = chunk.text;
        if (delta) yield delta;
      }
    },
  };
}
