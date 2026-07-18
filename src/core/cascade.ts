import type { ChatMessage, ModelCallOptions, ModelCapabilities, SchemaInput, ShapecraftModel } from "../types.js";
import { SchemaViolationError } from "../types.js";

export interface CascadeOptions {
  /**
   * How many failed attempts on the current model before escalating to the
   * next one. "Failed" means generate()/generateStream() called this model
   * again after the previous attempt didn't produce an accepted result -
   * structural failure, semantic-validator failure, and a too-low
   * confidenceScorer score all already collapse into that same signal, so
   * the cascade doesn't need to distinguish them. Default 1 - escalate on
   * the very first failure.
   */
  escalateAfterFailures?: number;
}

/**
 * Wraps an ordered list of models as a single `ShapecraftModel`. Delegates to
 * `models[0]` until it's failed `escalateAfterFailures` times in a row, then
 * moves to `models[1]`, and so on - capping at the last model (no wraparound).
 * `id`/`guaranteeLevel`/`capabilities` are getters reflecting whichever model
 * is currently active, so a successful result's metadata accurately shows
 * which model actually produced it.
 *
 * Works with generate(), generateStream(), and turnaround for free - none of
 * them need to know a cascade is a wrapper rather than a plain model. No
 * changes to the retry loop, validation pipeline, or GenerateOptions were
 * needed for this to work - see legacy-planning/18-model-cascade-plan.md.
 */
export function cascade(models: ShapecraftModel[], options: CascadeOptions = {}): ShapecraftModel {
  if (models.length === 0) throw new Error("cascade() requires at least one model");
  const escalateAfterFailures = Math.max(1, options.escalateAfterFailures ?? 1);

  let index = 0;
  let failuresOnCurrent = 0;

  function current(): ShapecraftModel {
    return models[index];
  }

  // Called at the start of every generate()/generateStream() invocation -
  // the first call for a fresh generate() run doesn't count as a prior
  // failure, so escalation only advances on the 2nd+ call.
  let calls = 0;
  function onCall(): void {
    calls++;
    if (calls === 1) return; // first attempt - nothing failed yet
    failuresOnCurrent++;
    if (failuresOnCurrent >= escalateAfterFailures && index < models.length - 1) {
      index++;
      failuresOnCurrent = 0;
    }
  }

  // `as ShapecraftModel`: `capabilities` is optional (`?:`) on the interface,
  // but a getter's declared return type can't express "sometimes absent"
  // under exactOptionalPropertyTypes the way a plain optional field can -
  // the object is a fully valid ShapecraftModel at runtime regardless.
  return {
    get id() {
      return current().id;
    },
    get guaranteeLevel() {
      return current().guaranteeLevel;
    },
    get capabilities(): ModelCapabilities | undefined {
      return current().capabilities;
    },
    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      onCall();
      return current().generate<T>(prompt, schema, systemPrompt, callOptions);
    },
    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const model = current();
      if (!model.chat) throw new Error(`cascade(): current model "${model.id}" does not implement chat()`);
      return model.chat(messages, systemPrompt);
    },
    // Unconditionally present (unlike the underlying models, where it's
    // optional) - a cascade can mix models with and without native
    // streaming, so whether *this* attempt actually streams depends on
    // which model is currently active, decided fresh per call. Falls back to
    // one-shot generate() for an attempt on a non-streaming model, same
    // fallback stream.ts itself uses when a plain model lacks generateStream.
    async *generateStream<T>(
      prompt: string,
      schema: SchemaInput<T>,
      systemPrompt?: string,
      callOptions?: ModelCallOptions
    ): AsyncIterable<string> {
      onCall();
      const model = current();
      if (model.generateStream) {
        yield* model.generateStream<T>(prompt, schema, systemPrompt, callOptions);
        return;
      }
      try {
        const result = await model.generate<T>(prompt, schema, systemPrompt, callOptions);
        yield typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (err) {
        // model.generate() threw (e.g. a SchemaViolationError from a
        // structural/semantic/confidence failure) - yield its raw failed
        // text instead of letting the throw escape this generator.
        // stream.ts's catch around the tokenize loop treats ANY thrown
        // error as fatal/non-retryable (it doesn't distinguish
        // SchemaViolationError); yielding text that will itself fail
        // parseAndValidate routes this through the same "streamed, then
        // failed validation" path every other retryable failure takes.
        if (err instanceof SchemaViolationError) {
          yield err.raw;
          return;
        }
        throw err;
      }
    },
  } as ShapecraftModel;
}
