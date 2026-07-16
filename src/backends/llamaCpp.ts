import type { ChatMessage, SchemaInput, ShapecraftModel } from "../types.js";
import { buildStructuredPrompt } from "../core/schema.js";
import { parseAndValidate } from "../core/parse.js";
import { isGbnfInput } from "../core/validate.js";
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
 * For other schema types (Zod / jsonSchema / pattern / xml / validator) this
 * backend currently runs a prompt-only, best-effort path — it does not yet
 * convert those to a grammar (that's the deferred JSON-Schema→GBNF converter).
 * Until then, treat non-`gbnf` inputs on `llamaCpp()` as best-effort despite the
 * nominal `constrained` level.
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

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      // Fail fast on a malformed grammar before loading a multi-GB model.
      if (isGbnfInput(schema)) parseGbnf(schema.gbnf);

      const { llama, model, mod } = await load();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let grammar: any;
      if (isGbnfInput(schema)) {
        grammar = await llama.createGrammar({ grammar: schema.gbnf });
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
