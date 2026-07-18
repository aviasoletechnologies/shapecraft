import type { GenerateOptions, GenerateResult, SchemaInput, ShapecraftModel } from "../types.js";
import { isZodSchema, isXmlInput, isGbnfInput } from "./validate.js";
import { toJsonSchema } from "./schema.js";

/** What a middleware sees for one generate() call. */
export interface MiddlewareContext<T = unknown> {
  model: ShapecraftModel;
  schema: SchemaInput<T>;
  prompt: string;
  options: GenerateOptions;
}

/** Calls the next middleware in the chain (or the real generate() call if this is the last one). */
export type NextFn<T> = () => Promise<GenerateResult<T>>;

/**
 * Koa-style onion middleware: wraps a generate() call for logging, caching,
 * telemetry, etc. Must call `next()` at most once — calling it twice throws,
 * calling it zero times short-circuits the real call (useful for a cache hit).
 */
export interface Middleware {
  <T>(ctx: MiddlewareContext<T>, next: NextFn<T>): Promise<GenerateResult<T>>;
}

/**
 * Composes middlewares into a single callable: `chain(ctx, core)` runs
 * middleware[0], which calls next() to run middleware[1], ... down to `core`
 * (the real generate() call). An empty array degenerates to calling `core`
 * directly.
 */
export function composeMiddleware(middlewares: Middleware[]) {
  return function chain<T>(ctx: MiddlewareContext<T>, core: NextFn<T>): Promise<GenerateResult<T>> {
    let lastIndexCalled = -1;

    function dispatch(i: number): Promise<GenerateResult<T>> {
      if (i <= lastIndexCalled) {
        return Promise.reject(new Error("Middleware called next() more than once"));
      }
      lastIndexCalled = i;

      const mw = middlewares[i];
      if (!mw) return core();
      return mw(ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}

/**
 * Minimal example middleware — logs before/after each call via the given
 * logger (defaults to console). Handy for wiring up createClient() quickly
 * and as a template for writing your own (caching, telemetry, retries-with-
 * backoff, etc. all follow the same next()-wrapping shape).
 */
export function loggingMiddleware(logger: Pick<Console, "log" | "error"> = console): Middleware {
  return async <T>(ctx: MiddlewareContext<T>, next: NextFn<T>): Promise<GenerateResult<T>> => {
    const label = `[shapecraft] ${ctx.model.id}`;
    logger.log(`${label} → request`);
    try {
      const result = await next();
      logger.log(`${label} ← done in ${result.metadata.latencyMs}ms (attempts=${result.attempts})`);
      return result;
    } catch (err) {
      logger.error(`${label} ← failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };
}

// Serializes a schema into a stable string for the cache key. `{ validate }`
// schemas carry a function (not serializable in a way that means anything
// stable across calls), so they get a unique key every time - effectively
// never cache-hit, which is the correct/safe behavior rather than caching on
// a coincidental function reference match.
let uncacheableCounter = 0;
function schemaCacheKeyPart(schema: SchemaInput): string {
  if (isZodSchema(schema)) return JSON.stringify(toJsonSchema(schema));
  if ("jsonSchema" in schema) return JSON.stringify(schema.jsonSchema);
  if ("pattern" in schema) return schema.pattern.toString();
  if (isGbnfInput(schema)) return schema.gbnf;
  if (isXmlInput(schema)) return JSON.stringify(schema.xml);
  return `__uncacheable__${uncacheableCounter++}`;
}

export interface ResponseCacheOptions {
  /** How long a cached result stays valid, in ms. Default 60_000 (1 minute). */
  ttlMs?: number;
}

/**
 * Caches generate() results keyed on model + schema + prompt (+ systemPrompt,
 * since it's part of the actual prompt sent to the model). An identical call
 * within `ttlMs` skips the model call entirely - `next()` is never invoked on
 * a hit, so no retries/latency/cost either.
 *
 * ponytail: a plain unbounded Map, no max-size or LRU eviction - fine for a
 * bounded number of distinct prompts; add an eviction policy if this ever
 * runs long enough against high-cardinality prompts for memory to matter.
 */
export function responseCacheMiddleware(options: ResponseCacheOptions = {}): Middleware {
  const ttlMs = options.ttlMs ?? 60_000;
  const cache = new Map<string, { result: GenerateResult<unknown>; expiresAt: number }>();

  return async <T>(ctx: MiddlewareContext<T>, next: NextFn<T>): Promise<GenerateResult<T>> => {
    const key = JSON.stringify([ctx.model.id, schemaCacheKeyPart(ctx.schema), ctx.prompt, ctx.options.systemPrompt ?? null]);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.result as GenerateResult<T>;
    }
    const result = await next();
    cache.set(key, { result, expiresAt: Date.now() + ttlMs });
    return result;
  };
}
