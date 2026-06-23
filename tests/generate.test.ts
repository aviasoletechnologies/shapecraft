import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { validateOutput } from "../src/core/schema.js";
import type { SchemaInput, ShapecraftModel } from "../src/types.js";
import { SchemaViolationError, MaxRetriesExceededError } from "../src/types.js";

function mockModel(returnValue: unknown, shouldFail = false): ShapecraftModel {
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(_prompt: string, schema: SchemaInput): Promise<T> {
      if (shouldFail) throw new SchemaViolationError("bad", "invalid");
      return returnValue as T;
    },
  };
}

const PersonSchema = z.object({ name: z.string(), age: z.number() });

describe("generate()", () => {
  it("returns data on success with Zod schema", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, PersonSchema, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("constrained");
  });

  it("retries and throws MaxRetriesExceededError", async () => {
    const model = mockModel(null, true);
    await expect(
      generate(model, PersonSchema, "get person", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});

describe("validateOutput()", () => {
  describe("Zod schema", () => {
    it("parses valid JSON", () => {
      const result = validateOutput<{ name: string }>(
        '{"name": "Alice", "age": 30}',
        PersonSchema
      );
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("throws on invalid JSON", () => {
      expect(() => validateOutput("not json", PersonSchema)).toThrow();
    });

    it("throws on schema mismatch", () => {
      expect(() =>
        validateOutput('{"name": 123}', PersonSchema)
      ).toThrow();
    });
  });

  describe("Raw JSON Schema", () => {
    const schema: SchemaInput = {
      jsonSchema: {
        type: "object",
        properties: { id: { type: "number" } },
      },
    };

    it("parses valid JSON", () => {
      const result = validateOutput<{ id: number }>('{"id": 42}', schema);
      expect(result).toEqual({ id: 42 });
    });

    it("throws on invalid JSON", () => {
      expect(() => validateOutput("bad", schema)).toThrow();
    });
  });

  describe("Regex pattern", () => {
    const schema: SchemaInput = { pattern: /^\d{4}-\d{2}-\d{2}$/ };

    it("accepts matching string", () => {
      expect(validateOutput("2024-01-15", schema)).toBe("2024-01-15");
    });

    it("trims whitespace before matching", () => {
      expect(validateOutput("  2024-01-15  ", schema)).toBe("2024-01-15");
    });

    it("throws on non-matching string", () => {
      expect(() => validateOutput("not-a-date", schema)).toThrow();
    });

    it("accepts string pattern", () => {
      const strSchema: SchemaInput = { pattern: "^\\d+$" };
      expect(validateOutput("12345", strSchema)).toBe("12345");
    });
  });

  describe("Custom validator", () => {
    const schema: SchemaInput = {
      validate: (x: unknown) =>
        typeof x === "object" && x !== null && "id" in x,
    };

    it("accepts output passing validator", () => {
      const result = validateOutput<{ id: number }>('{"id": 1}', schema);
      expect(result).toEqual({ id: 1 });
    });

    it("throws when validator returns false", () => {
      expect(() => validateOutput('{"name": "x"}', schema)).toThrow(
        "Custom validator returned false"
      );
    });
  });
});
