import type { ChatMessage, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt, toJsonSchema } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";
import { isGbnfInput, isZodSchema } from "../core/validate.js";
import { parseGbnf } from "../core/gbnf.js";

export interface LlamaCppBackendOptions {
  /** Path to a local .gguf model file. */
  modelPath: string;
  /** Layers to offload to the GPU (node-llama-cpp default if omitted). */
  gpuLayers?: number;
  /** Context window size. */
  contextSize?: number;
}

/**
 * node-llama-cpp backend — the first-class GBNF target. For a `{ gbnf }` input
 * the grammar is applied at the **token level**, so the output cannot violate it
 * (`guaranteeLevel: "constrained"`, valid by construction).
 *
 * Zod and `{ jsonSchema }` inputs are converted to JSON Schema and constrained
 * with node-llama-cpp's JSON-Schema grammar support. Other schema types remain
 * prompt-only and best-effort.
 */
export function llamaCpp(options: LlamaCppBackendOptions): ShapecraftModel {
  // The model load is the expensive step — do it once, lazily, and reuse it
  // across calls. A fresh context/session is created per generate() call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loaded: Promise<{ llama: any; model: any; mod: any }> | null = null;

  function load() {
    if (!loaded) {
      loaded = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import("node-llama-cpp").catch(() => {
          throw new Error("Install node-llama-cpp: npm install node-llama-cpp");
        });
        const llama = await mod.getLlama();
        const model = await llama.loadModel({ modelPath: options.modelPath, gpuLayers: options.gpuLayers });
        return { llama, model, mod };
      })();
    }
    return loaded;
  }

  return {
    id: `llamacpp:${options.modelPath}`,
    guaranteeLevel: "constrained",
    // This adapter does not implement streaming or toolCall() yet. The core
    // falls back to one-shot generate() for streaming; skill dispatch still
    // works because it only needs generate().
    capabilities: { streaming: false, chat: true, structuredOutput: true, toolCalling: false, skillDispatch: true },

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      // Fail fast on a malformed grammar before loading a multi-GB model.
      if (isGbnfInput(schema)) parseGbnf(schema.gbnf);

      const { llama, model, mod } = await load();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let grammar: any;
      if (isGbnfInput(schema)) {
        grammar = await llama.createGrammar({ grammar: schema.gbnf });
      } else if (isZodSchema(schema) || "jsonSchema" in schema) {
        const jsonSchema = isZodSchema(schema) ? toJsonSchema(schema) : schema.jsonSchema;
        grammar = await llama.createGrammarForJsonSchema(jsonSchema);
      }

      const context = await model.createContext(
        options.contextSize ? { contextSize: options.contextSize } : {}
      );
      try {
        const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);
        const session = new mod.LlamaChatSession({
          contextSequence: context.getSequence(),
          systemPrompt: system,
        });
        const answer: string = await session.prompt(user, grammar ? { grammar } : {});
        return parseAndValidate<T>(answer, schema);
      } finally {
        await context.dispose?.();
      }
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const { model, mod } = await load();
      const context = await model.createContext(
        options.contextSize ? { contextSize: options.contextSize } : {}
      );
      try {
        const session = new mod.LlamaChatSession({
          contextSequence: context.getSequence(),
          systemPrompt,
        });
        // Replay all but the last turn as history, prompt with the last.
        const history = messages.slice(0, -1);
        const last = messages[messages.length - 1];
        if (history.length > 0 && typeof session.setChatHistory === "function") {
          session.setChatHistory(
            history.map((m) => ({
              type: m.role === "user" ? "user" : "model",
              text: m.content,
            }))
          );
        }
        return await session.prompt(last?.content ?? "");
      } finally {
        await context.dispose?.();
      }
    },
  };
}
