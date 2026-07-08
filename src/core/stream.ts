import type { GenerateOptions, GenerateResult, ResultMetadata, SchemaInput, ShapecraftModel, StreamHandle } from "../types.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../types.js";
import { generate, parseProviderModel } from "./generate.js";
import { parseAndValidate } from "./parse.js";
import { createTimeoutGuard } from "./timeout.js";
import { tokenize } from "./streaming/tokenizer.js";
import { IncrementalParser } from "./streaming/incremental-parser.js";
import { validateFieldIfPossible } from "./streaming/validator.js";
import { StreamEmitter } from "./streaming/emitter.js";

/**
 * Orchestrates the four streaming stages per attempt:
 *
 *   Tokenizer (tokenize) -> Incremental Parser (IncrementalParser) ->
 *   Validator (validateFieldIfPossible / parseAndValidate) -> Emitter (StreamEmitter)
 *
 * This function owns only the retry/timeout/abort control flow - each stage
 * is an independent, separately testable unit that knows nothing about the
 * others.
 */
export function generateStream<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options: GenerateOptions = {}
): StreamHandle<T> {
  const maxRetries = options.maxRetries ?? 3;
  const { systemPrompt, timeoutMs, signal, jsonSchemaValidator } = options;
  const { provider, model: modelName } = parseProviderModel(model.id);

  const emitter = new StreamEmitter<T>();

  let resolveResult!: (result: GenerateResult<T>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<GenerateResult<T>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  async function pump(): Promise<void> {
    // No streaming support on this model - fall back to one-shot generate(),
    // and surface its full output as a single delta so textStream still works.
    if (!model.generateStream) {
      emitter.emit({ type: "attempt-start", attempt: 1 });
      const finalResult = await generate<T>(model, schema, prompt, options);
      const text = typeof finalResult.data === "string" ? finalResult.data : JSON.stringify(finalResult.data, null, 2);
      emitter.emit({ type: "delta", text, attempt: 1 });
      emitter.emit({ type: "done", result: finalResult });
      emitter.finish();
      resolveResult(finalResult);
      return;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Fail fast on an already-aborted signal - skip calling the backend
      // entirely rather than invoking it just to have the race discard it.
      if (signal?.aborted) {
        emitter.finish();
        rejectResult(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }

      const t0 = Date.now();
      emitter.emit({ type: "attempt-start", attempt });

      const parser = new IncrementalParser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const partialValue: Record<string, unknown> = {};
      let earlyFailure: SchemaViolationError | null = null;

      const { guard, signal: callSignal, cleanup } = createTimeoutGuard(timeoutMs, signal);
      const source = model.generateStream<T>(
        prompt,
        schema,
        systemPrompt,
        callSignal ? { signal: callSignal } : undefined
      );

      try {
        for await (const delta of tokenize(source, guard)) {
          emitter.emit({ type: "delta", text: delta, attempt });

          // Incremental per-field validation: the moment a top-level field's
          // JSON closes, check it against its own sub-schema immediately,
          // instead of waiting for the whole object.
          for (const { key, value } of parser.feed(delta)) {
            const fieldError = validateFieldIfPossible(schema, key, value, { jsonSchemaValidator });
            if (fieldError) {
              earlyFailure = new SchemaViolationError(parser.text, { field: key, error: fieldError });
              break;
            }

            partialValue[key] = value;
            emitter.emit({ type: "partial", value: { ...partialValue } as Partial<T>, attempt });
          }

          if (earlyFailure) break; // stop consuming further deltas - no point streaming a doomed attempt
        }
      } catch (err) {
        // Transport/network error, a timeout/abort, or a synchronous validation
        // throw (e.g. a bad XML template) - not a SchemaViolationError, so it
        // is never retried.
        cleanup();
        emitter.finish();
        rejectResult(err);
        return;
      }
      cleanup();

      if (earlyFailure) {
        emitter.emit({ type: "attempt-failed", attempt, error: earlyFailure });
        if (attempt === maxRetries) {
          emitter.finish();
          rejectResult(new MaxRetriesExceededError(maxRetries));
          return;
        }
        continue; // next attempt streams fresh
      }

      try {
        // extractJson: true is safe unconditionally - for a clean JSON buffer
        // the extraction regex matches the whole string (no-op); for a
        // best-effort backend that wraps JSON in prose, it's required.
        const data = parseAndValidate<T>(parser.text, schema, { extractJson: true });
        const metadata: ResultMetadata = { provider, model: modelName, latencyMs: Date.now() - t0 };
        const finalResult: GenerateResult<T> = { data, guaranteeLevel: model.guaranteeLevel, attempts: attempt, metadata };
        emitter.emit({ type: "done", result: finalResult });
        emitter.finish();
        resolveResult(finalResult);
        return;
      } catch (err) {
        if (!(err instanceof SchemaViolationError)) {
          emitter.finish();
          rejectResult(err);
          return;
        }
        emitter.emit({ type: "attempt-failed", attempt, error: err });
        if (attempt === maxRetries) {
          emitter.finish();
          rejectResult(new MaxRetriesExceededError(maxRetries));
          return;
        }
        // else: loop continues, next attempt streams fresh
      }
    }
  }

  pump().catch((err) => {
    emitter.finish();
    rejectResult(err);
  });

  return { textStream: emitter.textStream, events: emitter.events, result };
}
