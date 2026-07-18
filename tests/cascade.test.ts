import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { generateStream } from "../src/core/stream.js";
import { cascade } from "../src/core/cascade.js";
import { SchemaViolationError, MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel } from "../src/types.js";

const PersonSchema = z.object({ name: z.string(), age: z.number() });

function alwaysFails(id: string): ShapecraftModel {
  return {
    id,
    guaranteeLevel: "best-effort",
    async generate<T>(): Promise<T> {
      throw new SchemaViolationError("bad", "invalid");
    },
  };
}

function alwaysSucceeds(id: string, value: unknown): ShapecraftModel {
  return {
    id,
    guaranteeLevel: "native",
    async generate<T>(): Promise<T> {
      return value as T;
    },
  };
}

describe("cascade()", () => {
  it("stays on the only model when given a single-element list (no behavior change)", async () => {
    const m = cascade([alwaysSucceeds("solo", { name: "Alice", age: 30 })]);
    const result = await generate(m, PersonSchema, "x");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.metadata.provider).toBe("solo");
  });

  it("escalates to the next model after the default 1 failure", async () => {
    const m = cascade([alwaysFails("weak"), alwaysSucceeds("strong", { name: "Bob", age: 40 })]);
    const result = await generate(m, PersonSchema, "x", { maxRetries: 3 });
    expect(result.data).toEqual({ name: "Bob", age: 40 });
    expect(result.attempts).toBe(2);
  });

  it("result.metadata reflects the model that actually produced the result, not the first model", async () => {
    const m = cascade([alwaysFails("weak"), alwaysSucceeds("strong", { name: "Bob", age: 40 })]);
    const result = await generate(m, PersonSchema, "x", { maxRetries: 3 });
    expect(result.metadata.provider).toBe("strong");
  });

  it("result.guaranteeLevel reflects the model that actually produced the result", async () => {
    const m = cascade([alwaysFails("weak"), alwaysSucceeds("strong", { name: "Bob", age: 40 })]);
    const result = await generate(m, PersonSchema, "x", { maxRetries: 3 });
    expect(result.guaranteeLevel).toBe("native"); // "strong"'s level, not "weak"'s "best-effort"
  });

  it("respects escalateAfterFailures > 1", async () => {
    const m = cascade([alwaysFails("weak"), alwaysSucceeds("strong", { name: "Y", age: 2 })], {
      escalateAfterFailures: 3,
    });
    // attempt 1 on weak doesn't count as a failure yet (nothing has failed
    // before it runs); attempts 2-4 on weak each register a failure, and the
    // 3rd registered failure (attempt 4) crosses the threshold and escalates
    // before that same attempt's generate() call - so attempt 4 lands on
    // "strong" and succeeds.
    const result = await generate(m, PersonSchema, "x", { maxRetries: 4 });
    expect(result.metadata.provider).toBe("strong");
    expect(result.attempts).toBe(4);
  });

  it("never escalates past the last model - stays on it for remaining retries", async () => {
    const m = cascade([alwaysFails("a"), alwaysFails("b")]);
    await expect(generate(m, PersonSchema, "x", { maxRetries: 4 })).rejects.toBeInstanceOf(MaxRetriesExceededError);
    // both models exist and get tried; the important thing is it doesn't throw
    // an out-of-bounds error trying to escalate past index 1.
  });

  it("id/guaranteeLevel reflect the currently active model at read time", async () => {
    const weak = alwaysFails("weak");
    const strong = alwaysSucceeds("strong", { ok: true });
    const m = cascade([weak, strong]);
    expect(m.id).toBe("weak");
    expect(m.guaranteeLevel).toBe("best-effort");
    await generate(m, { validate: () => true }, "x", { maxRetries: 2 }).catch(() => {});
    expect(m.id).toBe("strong");
    expect(m.guaranteeLevel).toBe("native");
  });

  it("throws immediately if constructed with an empty list", () => {
    expect(() => cascade([])).toThrow(/at least one model/);
  });
});

describe("cascade() with generateStream()", () => {
  function streamAlwaysSucceeds(id: string, value: unknown): ShapecraftModel {
    return {
      id,
      guaranteeLevel: "native",
      async generate<T>(): Promise<T> {
        return value as T;
      },
      async *generateStream(): AsyncIterable<string> {
        yield JSON.stringify(value);
      },
    };
  }

  it("falls back to one-shot generate() for an attempt on a model without generateStream", async () => {
    // "weak" has no generateStream at all - the cascade's own generateStream
    // must fall back to weak.generate() for that attempt rather than throwing.
    const weak = alwaysFails("weak"); // no generateStream defined
    const strong = streamAlwaysSucceeds("strong", { name: "Z", age: 5 });
    const m = cascade([weak, strong]);
    const handle = generateStream(m, PersonSchema, "x", { maxRetries: 3 });
    const result = await handle.result;
    expect(result.data).toEqual({ name: "Z", age: 5 });
  });
});
