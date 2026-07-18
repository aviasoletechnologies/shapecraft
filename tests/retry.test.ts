import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { generateStream } from "../src/core/stream.js";
import { exponentialBackoff } from "../src/core/retry.js";
import { SchemaViolationError, MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel } from "../src/types.js";

const PersonSchema = z.object({ name: z.string(), age: z.number() });

function failNTimesThenSucceed(n: number, value: unknown): ShapecraftModel {
  let calls = 0;
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      calls++;
      if (calls <= n) throw new SchemaViolationError("bad", "invalid");
      return value as T;
    },
  };
}

// Streaming retries only happen when the accumulated buffer fails
// parseAndValidate after the stream ends (or an incremental field check
// fails) — a thrown error from generateStream() itself is never retried.
// So this mock yields malformed JSON on the first `n` attempts (fails
// parseAndValidate after the stream completes normally) and valid JSON after.
function streamFailNTimesThenSucceed(n: number, value: unknown): ShapecraftModel {
  let calls = 0;
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      return value as T;
    },
    async *generateStream(): AsyncIterable<string> {
      calls++;
      yield calls <= n ? "not valid json" : JSON.stringify(value);
    },
  };
}

// ─── exponentialBackoff ──────────────────────────────────────────────────────

describe("exponentialBackoff", () => {
  it("grows exponentially with jitter disabled", () => {
    const backoff = exponentialBackoff({ baseMs: 100, factor: 2, jitter: false });
    expect(backoff(1)).toBe(100);
    expect(backoff(2)).toBe(200);
    expect(backoff(3)).toBe(400);
  });

  it("caps at maxMs", () => {
    const backoff = exponentialBackoff({ baseMs: 100, factor: 2, maxMs: 250, jitter: false });
    expect(backoff(3)).toBe(250);
    expect(backoff(10)).toBe(250);
  });

  it("jitter (default) returns a value in [0, computed]", () => {
    const backoff = exponentialBackoff({ baseMs: 100, factor: 2, jitter: true });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const computed = 100 * 2 ** (attempt - 1);
      const value = backoff(attempt);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(computed);
    }
  });
});

// ─── generate() with retryDelayMs ────────────────────────────────────────────

describe("generate() with retryDelayMs", () => {
  it("defaults to no delay - retries fire immediately (unchanged behavior)", async () => {
    const model = failNTimesThenSucceed(1, { name: "Alice", age: 30 });
    const t0 = Date.now();
    const result = await generate(model, PersonSchema, "x", { maxRetries: 2 });
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("waits at least retryDelayMs between a failed attempt and the next one", async () => {
    const model = failNTimesThenSucceed(1, { name: "Alice", age: 30 });
    const t0 = Date.now();
    const result = await generate(model, PersonSchema, "x", { maxRetries: 2, retryDelayMs: 60 });
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });

  it("accepts a function, called with the attempt number that just failed", async () => {
    const seen: number[] = [];
    const model = failNTimesThenSucceed(2, { name: "Alice", age: 30 });
    await generate(model, PersonSchema, "x", {
      maxRetries: 3,
      retryDelayMs: (attempt) => {
        seen.push(attempt);
        return 10;
      },
    });
    expect(seen).toEqual([1, 2]);
  });

  it("does not wait after the final failed attempt before throwing", async () => {
    const model = failNTimesThenSucceed(5, null);
    const t0 = Date.now();
    await expect(
      generate(model, PersonSchema, "x", { maxRetries: 2, retryDelayMs: 500 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
    // 1 delay (after attempt 1), never a 2nd (after the final attempt 2)
    expect(Date.now() - t0).toBeLessThan(700);
  });

  it("an abort during the retry delay rejects immediately with the abort reason", async () => {
    const model = failNTimesThenSucceed(5, null);
    const controller = new AbortController();
    const promise = generate(model, PersonSchema, "x", {
      maxRetries: 3,
      retryDelayMs: 500,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("cancelled mid-backoff")), 20);
    await expect(promise).rejects.toThrow("cancelled mid-backoff");
  });
});

// ─── generateStream() with retryDelayMs ──────────────────────────────────────

describe("generateStream() with retryDelayMs", () => {
  it("waits at least retryDelayMs between a failed attempt and the next one", async () => {
    const model = streamFailNTimesThenSucceed(1, { name: "Alice", age: 30 });
    const t0 = Date.now();
    const handle = generateStream(model, PersonSchema, "x", { maxRetries: 2, retryDelayMs: 60 });
    const result = await handle.result;
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });
});
