import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { anthropic } from "../src/backends/index.js";
import { mockModel } from "./helpers/index.js";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});


// Ensure the module is imported for coverage

describe("generate", () => {
  it("returns data on success", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, PersonSchema, "get person");
    expect(result.data).toMatchObject({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("constrained");
  });

  it("retries on failure and throws MaxRetriesExceededError", async () => {
    const model = mockModel(null, true);
    const { MaxRetriesExceededError } = await import("../src/types.js");
    await expect(
      generate(model, PersonSchema, "get person", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});

describe("anthropic-model-test", () => {
  it("returns data on success", async () => {
    const model = anthropic({apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-haiku-4-5-20251001"});
    const result = await generate(model, PersonSchema, "Abhi has a friend named Alice who is 30 years old");
    console.log("Result:", result);
    expect(result.data).toMatchObject({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("best-effort");
  });

  it("returns best-effort guaranteeLevel", async () => {
    const model = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-haiku-4-5-20251001" });
    const result = await generate(model, PersonSchema, "Bob is 25 years old");
    expect(result.guaranteeLevel).toBe("best-effort");
    expect(result.data).toMatchObject({ name: expect.any(String), age: expect.any(Number) });
  });
});
