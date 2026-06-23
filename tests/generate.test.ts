import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import type { ShapecraftModel } from "../src/types.js";
import { SchemaViolationError } from "../src/types.js";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

function mockModel(returnValue: unknown, shouldFail = false): ShapecraftModel {
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      if (shouldFail) throw new SchemaViolationError("bad", "invalid");
      return returnValue as T;
    },
  };
}

describe("generate", () => {
  it("returns data on success", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, PersonSchema, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
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
