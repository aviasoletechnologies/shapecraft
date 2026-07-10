import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { generateStream } from "../src/core/stream.js";
import { createClient } from "../src/core/client.js";
import { composeMiddleware, loggingMiddleware } from "../src/core/middleware.js";
import type { Middleware, MiddlewareContext, NextFn } from "../src/core/middleware.js";
import { MaxRetriesExceededError, SchemaViolationError, TimeoutError } from "../src/types.js";
import type { GenerateResult, ModelCallOptions, SchemaInput, ShapecraftModel } from "../src/types.js";
import { mockModel } from "./helpers/index.js";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

/** Resolves after `ms`. If `wellBehaved`, actually cancels its own timer on
 * abort (like a real fetch/SDK call would) and records whether it was
 * cancelled — lets tests prove `signal` really reaches the backend, not just
 * that the core stops waiting. */
function delayedMockModel(ms: number, returnValue: unknown, opts: { wellBehaved?: boolean; onAbort?: () => void } = {}): ShapecraftModel {
  return {
    id: "mockprovider:mockmodel",
    guaranteeLevel: "constrained",
    async generate<T>(_p: string, _s: SchemaInput<T>, _sys?: string, callOptions?: ModelCallOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => resolve(returnValue as T), ms);
        if (opts.wellBehaved && callOptions?.signal) {
          callOptions.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            opts.onAbort?.();
            reject(callOptions.signal!.reason ?? new DOMException("Aborted", "AbortError"));
          });
        }
      });
    },
  };
}

function streamingMockModel(chunks: string[], perChunkMs = 0): ShapecraftModel {
  return {
    id: "mockprovider:streammodel",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      throw new Error("generate() should not be called in streaming tests");
    },
    async *generateStream<T>(): AsyncIterable<string> {
      for (const c of chunks) {
        if (perChunkMs) await new Promise((r) => setTimeout(r, perChunkMs));
        yield c;
      }
    },
  } as ShapecraftModel;
}

// ─── 7.1 createClient() + middleware ───────────────────────────────────────────

describe("createClient + middleware", () => {
  it("wraps generate() and returns the same result shape as calling generate() directly", async () => {
    const client = createClient();
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await client.generate(model, z.object({ name: z.string(), age: z.number() }), "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.metadata.provider).toBe("mock");
  });

  it("runs middleware in onion order (outer before/after wraps inner before/after)", async () => {
    const order: string[] = [];
    const tag =
      (name: string): Middleware =>
      async (ctx, next) => {
        order.push(`${name}:before`);
        const result = await next();
        order.push(`${name}:after`);
        return result;
      };

    const client = createClient({ middleware: [tag("outer"), tag("inner")] });
    await client.generate(mockModel({ ok: true }), { validate: () => true }, "x");

    expect(order).toEqual(["outer:before", "inner:before", "inner:after", "outer:after"]);
  });

  it("a middleware that never calls next() short-circuits — the real generate() never runs", async () => {
    let coreCalled = false;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        coreCalled = true;
        return {} as T;
      },
    };
    const cached: GenerateResult<unknown> = {
      data: { cached: true },
      guaranteeLevel: "constrained",
      attempts: 0,
      metadata: { provider: "cache", model: "n/a", latencyMs: 0 },
    };
    const shortCircuit: Middleware = async () => cached;

    const client = createClient({ middleware: [shortCircuit] });
    const result = await client.generate(model, { validate: () => true }, "x");

    expect(result).toBe(cached);
    expect(coreCalled).toBe(false);
  });

  it("calling next() twice rejects with a clear error", async () => {
    const doubleNext: Middleware = async (_ctx, next) => {
      await next();
      return next(); // second call — must reject
    };
    const client = createClient({ middleware: [doubleNext] });
    await expect(client.generate(mockModel({ ok: true }), { validate: () => true }, "x")).rejects.toThrow(/next\(\) more than once/);
  });

  it("propagates an error thrown by a middleware after next() resolves", async () => {
    const throwsAfter: Middleware = async (_ctx, next) => {
      await next();
      throw new Error("post-processing failed");
    };
    const client = createClient({ middleware: [throwsAfter] });
    await expect(client.generate(mockModel({ ok: true }), { validate: () => true }, "x")).rejects.toThrow("post-processing failed");
  });

  it("client-level retry/timeout defaults apply, and a per-call option overrides them", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        calls++;
        throw new SchemaViolationError("bad", "invalid");
      },
    };
    const client = createClient({ retry: { max: 2 } });
    await expect(client.generate(model, { validate: () => true }, "x")).rejects.toBeInstanceOf(MaxRetriesExceededError);
    expect(calls).toBe(2); // client default honored

    calls = 0;
    await expect(client.generate(model, { validate: () => true }, "x", { maxRetries: 5 })).rejects.toBeInstanceOf(MaxRetriesExceededError);
    expect(calls).toBe(5); // per-call override wins
  });

  it("loggingMiddleware logs a request/done pair through a custom logger without throwing", async () => {
    const logs: string[] = [];
    const logger = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(`ERR:${m}`) };
    const client = createClient({ middleware: [loggingMiddleware(logger)] });
    await client.generate(mockModel({ ok: true }), { validate: () => true }, "x");
    expect(logs.some((l) => l.includes("request"))).toBe(true);
    expect(logs.some((l) => l.includes("done"))).toBe(true);
  });

  it("stress: 100 chained middlewares still preserve order and complete", async () => {
    const order: number[] = [];
    const middlewares: Middleware[] = Array.from({ length: 100 }, (_, i) => async (_ctx, next) => {
      order.push(i);
      const r = await next();
      order.push(-i);
      return r;
    });
    const chain = composeMiddleware(middlewares);
    const ctx: MiddlewareContext<unknown> = { model: mockModel({ ok: true }), schema: { validate: () => true }, prompt: "x", options: {} };
    const core: NextFn<unknown> = async () => ({
      data: { ok: true },
      guaranteeLevel: "constrained",
      attempts: 1,
      metadata: { provider: "mock", model: "test", latencyMs: 0 },
    });
    const result = await chain(ctx, core);
    expect(result.data).toEqual({ ok: true });
    expect(order.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(order.slice(100)).toEqual(Array.from({ length: 100 }, (_, i) => -(99 - i)));
  });
});

// ─── 7.2 Metadata ───────────────────────────────────────────────────────────────

describe("GenerateResult.metadata", () => {
  it("parses provider/model from a `provider:model` id and measures latency", async () => {
    const model = delayedMockModel(20, { ok: true });
    const result = await generate(model, { validate: () => true }, "x");
    expect(result.metadata.provider).toBe("mockprovider");
    expect(result.metadata.model).toBe("mockmodel");
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(15);
  });

  it("falls back to the whole id for provider AND model when there's no colon", async () => {
    const model: ShapecraftModel = { id: "solo", guaranteeLevel: "constrained", async generate<T>(): Promise<T> { return {} as T; } };
    const result = await generate(model, { validate: () => true }, "x");
    expect(result.metadata.provider).toBe("solo");
    expect(result.metadata.model).toBe("solo");
  });

  it("is present on generateStream()'s final result too", async () => {
    const model = streamingMockModel(['{"a":1}']);
    const stream = generateStream(model, { jsonSchema: { type: "object", properties: { a: { type: "number" } } } }, "x");
    const result = await stream.result;
    expect(result.metadata.provider).toBe("mockprovider");
    expect(typeof result.metadata.latencyMs).toBe("number");
  });

  it("existing consumers destructuring only {data, attempts, guaranteeLevel} are unaffected by the new field", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const { data, attempts, guaranteeLevel } = await generate(model, z.object({ name: z.string(), age: z.number() }), "x");
    expect(data).toEqual({ name: "Alice", age: 30 });
    expect(attempts).toBe(1);
    expect(guaranteeLevel).toBe("constrained");
  });
});

// ─── 7.3 AbortSignal + timeout ──────────────────────────────────────────────────

describe("timeoutMs / signal — generate()", () => {
  it("no timeoutMs/signal: behavior is byte-for-byte unchanged (regression)", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, z.object({ name: z.string(), age: z.number() }), "x");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
  });

  it("throws TimeoutError when the attempt exceeds timeoutMs", async () => {
    const model = delayedMockModel(200, { ok: true });
    await expect(generate(model, { validate: () => true }, "x", { timeoutMs: 30, maxRetries: 1 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("core-level timeout still bounds wait time even against a backend that ignores signal", async () => {
    const model = delayedMockModel(500, { ok: true }, { wellBehaved: false });
    const t0 = Date.now();
    await expect(generate(model, { validate: () => true }, "x", { timeoutMs: 40, maxRetries: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t0).toBeLessThan(200); // returned way before the mock's 500ms delay
  });

  it("a well-behaved backend actually gets cancelled when timeoutMs fires", async () => {
    let cancelled = false;
    const model = delayedMockModel(500, { ok: true }, { wellBehaved: true, onAbort: () => (cancelled = true) });
    await expect(generate(model, { validate: () => true }, "x", { timeoutMs: 30, maxRetries: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(cancelled).toBe(true);
  });

  it("an externally aborted signal rejects with the abort reason, not TimeoutError", async () => {
    const controller = new AbortController();
    const model = delayedMockModel(200, { ok: true }, { wellBehaved: true });
    const promise = generate(model, { validate: () => true }, "x", { signal: controller.signal, maxRetries: 1 });
    setTimeout(() => controller.abort(new Error("user cancelled")), 20);
    await expect(promise).rejects.toThrow("user cancelled");
  });

  it("an already-aborted signal rejects immediately without ever calling the model", async () => {
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    let called = false;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        called = true;
        return {} as T;
      },
    };
    await expect(generate(model, { validate: () => true }, "x", { signal: controller.signal, maxRetries: 1 })).rejects.toThrow("pre-aborted");
    expect(called).toBe(false);
  });

  it("TimeoutError is not retried (propagates immediately, like other non-SchemaViolationError errors)", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        calls++;
        return new Promise<T>((resolve) => setTimeout(() => resolve({} as T), 500));
      },
    };
    await expect(generate(model, { validate: () => true }, "x", { timeoutMs: 20, maxRetries: 5 })).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it("stress: many concurrent timed-out calls all reject independently, staying near their own timeout (not serialized)", async () => {
    const model = delayedMockModel(300, { ok: true }, { wellBehaved: true });
    const t0 = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => generate(model, { validate: () => true }, "x", { timeoutMs: 25, maxRetries: 1 }))
    );
    const elapsed = Date.now() - t0;
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(elapsed).toBeLessThan(250); // ran concurrently, not queued 25x25ms+
  });
});

describe("timeoutMs / signal — generateStream()", () => {
  it("no timeoutMs/signal: streaming behavior is unchanged (regression)", async () => {
    const model = streamingMockModel(['{"name":', '"Alice",', '"age":30}']);
    const stream = generateStream(model, z.object({ name: z.string(), age: z.number() }), "x");
    const result = await stream.result;
    expect(result.data).toEqual({ name: "Alice", age: 30 });
  });

  it("a hung stream (no next chunk in time) rejects with TimeoutError", async () => {
    const model = streamingMockModel(["a", "b", "c"], 200); // 200ms between chunks
    const stream = generateStream(model, { pattern: /.*/ }, "x", { timeoutMs: 30, maxRetries: 1 });
    await expect(stream.result).rejects.toBeInstanceOf(TimeoutError);
  });

  it("an external signal aborts an in-progress stream", async () => {
    const controller = new AbortController();
    const model = streamingMockModel(["a", "b", "c", "d", "e"], 30);
    const stream = generateStream(model, { pattern: /.*/ }, "x", { signal: controller.signal, maxRetries: 1 });
    setTimeout(() => controller.abort(new Error("stop streaming")), 45);
    await expect(stream.result).rejects.toThrow("stop streaming");
  });
});

// ─── 7.4 Pluggable JSON Schema validator ───────────────────────────────────────

describe("jsonSchemaValidator (pluggable)", () => {
  const schema = { jsonSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } };

  it("default (omitted) behavior is unchanged — built-in checkJsonSchema still enforces required fields", async () => {
    const model = mockModel({});
    await expect(generate(model, schema, "x", { maxRetries: 1 })).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("a custom validator can be MORE permissive than the built-in default", async () => {
    const model = mockModel({}); // missing "name" — built-in would reject
    const permissive = () => {}; // never throws
    const result = await generate(model, schema, "x", { jsonSchemaValidator: permissive, maxRetries: 1 });
    expect(result.data).toEqual({});
  });

  it("a custom validator can be MORE strict than the built-in default", async () => {
    const model = mockModel({ name: "ab" }); // built-in default would accept this
    const strict = (value: unknown) => {
      const v = value as { name?: string };
      if (!v.name || v.name.length < 3) throw new Error("name must be at least 3 chars");
    };
    await expect(generate(model, schema, "x", { jsonSchemaValidator: strict, maxRetries: 1 })).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("applies to generateStream()'s per-field partial validation too", async () => {
    const objSchema = { jsonSchema: { type: "object", properties: { code: { type: "string" } } } };
    const model = streamingMockModel(['{"code":', '"AB"}']);
    const permissiveForCode = (value: unknown) => {
      // built-in checkJsonSchema has no length constraint; a custom one adds one
      if (typeof value === "string" && value.length < 5) throw new Error("code too short");
    };
    const stream = generateStream(model, objSchema, "x", { jsonSchemaValidator: permissiveForCode, maxRetries: 1 });
    await expect(stream.result).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});
