import type { GenerateOptions, GenerateResult, SchemaInput, ShapecraftModel } from "../types.js";

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
