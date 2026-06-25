import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { anthropic } from "../src/backends/anthropic.js";
import { mockModel } from "./helpers/index.js";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe("generate", () => {
  it("returns data on success", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, PersonSchema, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("constrained");
  });

  it("retries on SchemaViolationError and throws MaxRetriesExceededError", async () => {
    const model = mockModel(null, true);
    const { MaxRetriesExceededError } = await import("../src/types.js");
    await expect(
      generate(model, PersonSchema, "get person", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("re-throws non-schema errors immediately without retrying", async () => {
    let calls = 0;
    const model = {
      id: "mock:test",
      guaranteeLevel: "constrained" as const,
      async generate<T>(): Promise<T> {
        calls++;
        throw new Error("network failure");
      },
    };
    await expect(
      generate(model, PersonSchema, "get person", { maxRetries: 3 })
    ).rejects.toThrow("network failure");
    expect(calls).toBe(1);
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("anthropic integration", () => {
  it("returns structured data from real API", async () => {
    const model = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-haiku-4-5-20251001" });
    const result = await generate(model, PersonSchema, "Alice is 30 years old");
    expect(result.data).toMatchObject({ name: expect.any(String), age: expect.any(Number) });
    expect(result.guaranteeLevel).toBe("best-effort");
  }, 30000);
});
