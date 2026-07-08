import type { GenerateOptions, GenerateResult, ResultMetadata, SchemaInput, ShapecraftModel, StreamEvent, StreamHandle } from "../types.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../types.js";
import { generate, parseProviderModel } from "./generate.js";
import { parseAndValidate } from "./parse.js";
import { extractCompletedTopLevelFields, validateFieldIfPossible } from "./incremental.js";
import { createTimeoutGuard } from "./timeout.js";

/**
 * Single-consumer async channel. textStream and events are two independent
 * channels fed by the same pump — each is meant to be iterated by at most one
 * consumer, matching how streamGenerate()'s two views are actually used.
 */
function createChannel<T>(): { push(item: T): void; end(): void; iterable: AsyncIterable<T> } {
  const buffer: T[] = [];
  let ended = false;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;

  function push(item: T): void {
    if (ended) return;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: item, done: false });
    } else {
      buffer.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) return Promise.resolve({ value: buffer.shift() as T, done: false });
          if (ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };

  return { push, end, iterable };
}

export function generateStream<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options: GenerateOptions = {}
): StreamHandle<T> {
  const maxRetries = options.maxRetries ?? 3;
  const { systemPrompt, timeoutMs, signal, jsonSchemaValidator } = options;
  const { provider, model: modelName } = parseProviderModel(model.id);

  const textChannel = createChannel<string>();
  const eventChannel = createChannel<StreamEvent<T>>();

  let resolveResult!: (result: GenerateResult<T>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<GenerateResult<T>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function emit(event: StreamEvent<T>): void {
    eventChannel.push(event);
    if (event.type === "delta") textChannel.push(event.text);
  }

  function finish(): void {
    eventChannel.end();
    textChannel.end();
  }

  async function pump(): Promise<void> {
    // No streaming support on this model — fall back to one-shot generate(),
    // and surface its full output as a single delta so textStream still works.
    if (!model.generateStream) {
      emit({ type: "attempt-start", attempt: 1 });
      const finalResult = await generate<T>(model, schema, prompt, options);
      const text = typeof finalResult.data === "string" ? finalResult.data : JSON.stringify(finalResult.data, null, 2);
      emit({ type: "delta", text, attempt: 1 });
      emit({ type: "done", result: finalResult });
      finish();
      resolveResult(finalResult);
      return;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Fail fast on an already-aborted signal — skip calling the backend
      // entirely rather than invoking it just to have the race discard it.
      if (signal?.aborted) {
        finish();
        rejectResult(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }

      const t0 = Date.now();
      emit({ type: "attempt-start", attempt });
      let buffer = "";
      const validatedKeys = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const partialValue: Record<string, unknown> = {};
      let earlyFailure: SchemaViolationError | null = null;

      const { guard, signal: callSignal, cleanup } = createTimeoutGuard(timeoutMs, signal);
      const iterator = model.generateStream<T>(
        prompt,
        schema,
        systemPrompt,
        callSignal ? { signal: callSignal } : undefined
      )[Symbol.asyncIterator]();

      try {
        while (true) {
          // Race each chunk (not the whole stream) against the shared guard,
          // so a hung backend that never yields a next chunk still respects
          // timeoutMs/signal instead of blocking generateStream() forever.
          const next = await Promise.race([iterator.next(), guard]);
          if (next.done) break;
          const delta = next.value;

          buffer += delta;
          emit({ type: "delta", text: delta, attempt });

          // Incremental per-field validation: the moment a top-level field's
          // JSON closes, check it against its own sub-schema immediately,
          // instead of waiting for the whole object. Only applies to schemas
          // that decompose into named fields (Zod object / jsonSchema with
          // properties) — everything else is a no-op here.
          const completedFields = extractCompletedTopLevelFields(buffer);
          for (const [key, raw] of Object.entries(completedFields)) {
            if (validatedKeys.has(key)) continue;
            validatedKeys.add(key);

            let value: unknown;
            try {
              value = JSON.parse(raw);
            } catch {
              continue; // shouldn't happen — the scanner only returns syntactically closed values
            }

            const fieldError = validateFieldIfPossible(schema, key, value, { jsonSchemaValidator });
            if (fieldError) {
              earlyFailure = new SchemaViolationError(buffer, { field: key, error: fieldError });
              break;
            }

            partialValue[key] = value;
            emit({ type: "partial", value: { ...partialValue } as Partial<T>, attempt });
          }

          if (earlyFailure) break; // stop consuming further deltas — no point streaming a doomed attempt
        }
      } catch (err) {
        // Transport/network error, a timeout/abort, or a synchronous validation
        // throw (e.g. a bad XML template) — not a SchemaViolationError, so it
        // is never retried.
        await iterator.return?.().catch(() => {}); // stop the underlying generator cleanly
        cleanup();
        finish();
        rejectResult(err);
        return;
      }
      cleanup();

      if (earlyFailure) {
        emit({ type: "attempt-failed", attempt, error: earlyFailure });
        if (attempt === maxRetries) {
          finish();
          rejectResult(new MaxRetriesExceededError(maxRetries));
          return;
        }
        continue; // next attempt streams fresh
      }

      try {
        // extractJson: true is safe unconditionally — for a clean JSON buffer
        // the extraction regex matches the whole string (no-op); for a
        // best-effort backend that wraps JSON in prose, it's required.
        const data = parseAndValidate<T>(buffer, schema, { extractJson: true });
        const metadata: ResultMetadata = { provider, model: modelName, latencyMs: Date.now() - t0 };
        const finalResult: GenerateResult<T> = { data, guaranteeLevel: model.guaranteeLevel, attempts: attempt, metadata };
        emit({ type: "done", result: finalResult });
        finish();
        resolveResult(finalResult);
        return;
      } catch (err) {
        if (!(err instanceof SchemaViolationError)) {
          finish();
          rejectResult(err);
          return;
        }
        emit({ type: "attempt-failed", attempt, error: err });
        if (attempt === maxRetries) {
          finish();
          rejectResult(new MaxRetriesExceededError(maxRetries));
          return;
        }
        // else: loop continues, next attempt streams fresh
      }
    }
  }

  pump().catch((err) => {
    finish();
    rejectResult(err);
  });

  return { textStream: textChannel.iterable, events: eventChannel.iterable, result };
}
