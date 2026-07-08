import type { GenerateOptions, GenerateResult, JsonSchemaValidator, SchemaInput, ShapecraftModel, StreamHandle } from "../types.js";
import { generate } from "./generate.js";
import { generateStream } from "./stream.js";
import { composeMiddleware } from "./middleware.js";
import type { Middleware, MiddlewareContext } from "./middleware.js";

export interface CreateClientOptions {
  /** Applied in array order — middleware[0] is outermost (sees the request first, the result/error last). */
  middleware?: Middleware[];
  /** Default retry ceiling for every call through this client; a per-call `options.maxRetries` still overrides it. */
  retry?: { max?: number };
  /** Default per-call timeout; a per-call `options.timeoutMs` still overrides it. */
  timeoutMs?: number;
  /** Default pluggable JSON Schema validator (see `GenerateOptions.jsonSchemaValidator`) for every call through this client. */
  jsonSchemaValidator?: JsonSchemaValidator;
}

export interface ShapecraftClient {
  generate<T>(model: ShapecraftModel, schema: SchemaInput<T>, prompt: string, options?: GenerateOptions): Promise<GenerateResult<T>>;
  generateStream<T>(model: ShapecraftModel, schema: SchemaInput<T>, prompt: string, options?: GenerateOptions): StreamHandle<T>;
}

/**
 * Wraps generate()/generateStream() with a middleware pipeline and client-level
 * defaults (retry/timeout/validator) — purely additive sugar. Existing direct
 * calls to generate()/generateStream() are completely unaffected by this
 * existing; it's a new, optional entry point, not a replacement.
 *
 * Middleware wraps `generate()` only. `generateStream()` is not threaded
 * through the pipeline — its async-iterable shape doesn't fit the simple
 * before/after `next()` model cleanly (see the streaming-parser-refactor
 * item in PLAN-Updated.md). It still receives the client's retry/timeout/
 * validator defaults, just not middleware interception.
 *
 * `turnaround` calls are out of scope for this wrapper in v1 — use the
 * top-level `generate(model, schema, prompt, options, { turnaround: true })`
 * directly for multi-turn conversations.
 */
export function createClient(clientOptions: CreateClientOptions = {}): ShapecraftClient {
  const chain = composeMiddleware(clientOptions.middleware ?? []);

  function mergeOptions(options: GenerateOptions): GenerateOptions {
    return {
      ...(clientOptions.retry?.max !== undefined ? { maxRetries: clientOptions.retry.max } : {}),
      ...(clientOptions.timeoutMs !== undefined ? { timeoutMs: clientOptions.timeoutMs } : {}),
      ...(clientOptions.jsonSchemaValidator !== undefined ? { jsonSchemaValidator: clientOptions.jsonSchemaValidator } : {}),
      ...options, // per-call options always win over client-level defaults
    };
  }

  return {
    generate<T>(
      model: ShapecraftModel,
      schema: SchemaInput<T>,
      prompt: string,
      options: GenerateOptions = {}
    ): Promise<GenerateResult<T>> {
      const ctx: MiddlewareContext<T> = { model, schema, prompt, options: mergeOptions(options) };
      return chain(ctx, () => generate<T>(ctx.model, ctx.schema, ctx.prompt, ctx.options));
    },

    generateStream<T>(
      model: ShapecraftModel,
      schema: SchemaInput<T>,
      prompt: string,
      options: GenerateOptions = {}
    ): StreamHandle<T> {
      return generateStream<T>(model, schema, prompt, mergeOptions(options));
    },
  };
}
