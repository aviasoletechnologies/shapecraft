import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createClient } from "../src/core/client.js";
import { responseCacheMiddleware } from "../src/core/middleware.js";
import type { ShapecraftModel } from "../src/types.js";

function countingModel(id = "mock:test"): { model: ShapecraftModel; calls: () => number } {
  let calls = 0;
  const model: ShapecraftModel = {
    id,
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      calls++;
      return { name: "Alice", age: 30 } as T;
    },
  };
  return { model, calls: () => calls };
}

const PersonSchema = z.object({ name: z.string(), age: z.number() });

describe("responseCacheMiddleware", () => {
  it("a second identical call is a cache hit - no model call, same result", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });

    const r1 = await client.generate(model, PersonSchema, "extract Alice");
    const r2 = await client.generate(model, PersonSchema, "extract Alice");

    expect(calls()).toBe(1);
    expect(r2).toBe(r1); // literally the same cached object, not just equal
  });

  it("a different prompt is a cache miss", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });

    await client.generate(model, PersonSchema, "extract Alice");
    await client.generate(model, PersonSchema, "extract Bob");

    expect(calls()).toBe(2);
  });

  it("a different schema is a cache miss, even with the same prompt", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    const OtherSchema = z.object({ id: z.string().optional() }); // mock always returns {name, age} - optional-only so it still validates

    await client.generate(model, PersonSchema, "x");
    await client.generate(model, OtherSchema, "x");

    expect(calls()).toBe(2);
  });

  it("a different model id is a cache miss, even with the same schema+prompt", async () => {
    const a = countingModel("mock:a");
    const b = countingModel("mock:b");
    const client = createClient({ middleware: [responseCacheMiddleware()] });

    await client.generate(a.model, PersonSchema, "x");
    await client.generate(b.model, PersonSchema, "x");

    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(1);
  });

  it("does not share cached results between distinct model instances with the same id", async () => {
    const first = countingModel("mock:shared");
    let secondCalls = 0;
    const second: ShapecraftModel = {
      id: "mock:shared",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        secondCalls++;
        return { name: "Bob", age: 40 } as T;
      },
    };
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    await client.generate(first.model, PersonSchema, "x");
    const result = await client.generate(second, PersonSchema, "x");
    expect(result.data.name).toBe("Bob");
    expect(secondCalls).toBe(1);
  });

  it("does not reuse a result when validation rules change", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    await client.generate(model, PersonSchema, "x", { maxRetries: 1 });
    await expect(client.generate(model, PersonSchema, "x", {
      maxRetries: 1,
      semanticValidator: () => { throw new Error("not grounded"); },
    })).rejects.toThrow();
    expect(calls()).toBe(2);
  });

  it("keeps Zod refinements separate even when their JSON schemas match", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    const loose = z.object({ name: z.string(), age: z.number() });
    const strict = loose.refine((value) => value.name === "Bob");
    await client.generate(model, loose, "x", { maxRetries: 1 });
    await expect(client.generate(model, strict, "x", { maxRetries: 1 })).rejects.toThrow();
    expect(calls()).toBe(2);
  });

  it("does not cache stateful global regex validation", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock:text",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        calls++;
        return "Alice" as T;
      },
    };
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    const schema = { pattern: /Alice/g };
    await client.generate(model, schema, "x", { maxRetries: 1 });
    await expect(client.generate(model, schema, "x", { maxRetries: 1 })).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("a different systemPrompt is a cache miss", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });

    await client.generate(model, PersonSchema, "x", { systemPrompt: "Be terse." });
    await client.generate(model, PersonSchema, "x", { systemPrompt: "Be verbose." });

    expect(calls()).toBe(2);
  });

  it("expires after ttlMs", async () => {
    vi.useFakeTimers();
    try {
      const { model, calls } = countingModel();
      const client = createClient({ middleware: [responseCacheMiddleware({ ttlMs: 100 })] });

      await client.generate(model, PersonSchema, "x");
      vi.advanceTimersByTime(150);
      await client.generate(model, PersonSchema, "x");

      expect(calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("{ validate } schemas are never cache-hit (the check function isn't a stable cache key)", async () => {
    const { model, calls } = countingModel();
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    const schema = { validate: () => true };

    await client.generate(model, schema, "x");
    await client.generate(model, schema, "x");

    expect(calls()).toBe(2);
  });

  it("a cache hit skips the underlying model call entirely", async () => {
    let callCount = 0;
    const model: ShapecraftModel = {
      id: "mock:slow",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        callCount++;
        return { ok: true } as T;
      },
    };
    const client = createClient({ middleware: [responseCacheMiddleware()] });
    const schema = { jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } } };

    await client.generate(model, schema, "x"); // miss - real call
    await client.generate(model, schema, "x"); // hit - no call
    await client.generate(model, schema, "x"); // hit - no call

    expect(callCount).toBe(1);
  });
});
