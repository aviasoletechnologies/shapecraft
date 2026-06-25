import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate.js";
import { SchemaViolationError, MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel } from "../src/types.js";
import { mockModel } from "./helpers/index.js";

// ─── Raw JSON Schema ──────────────────────────────────────────────────────────

describe("Schema Flexibility — Raw JSON Schema input", () => {
  const rawSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name", "age"],
  };

  it("returns data when output matches raw JSON schema", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const result = await generate(model, { jsonSchema: rawSchema }, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
  });

  it("throws MaxRetriesExceededError when output fails raw JSON schema validation", async () => {
    const model = mockModel({ name: 123, age: "wrong" });
    await expect(
      generate(model, { jsonSchema: rawSchema }, "get person", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("retries on failure before succeeding", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        calls++;
        if (calls < 3) throw new SchemaViolationError("bad", "invalid");
        return { name: "Alice", age: 30 } as T;
      },
    };
    const result = await generate(model, { jsonSchema: rawSchema }, "get person", { maxRetries: 3 });
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(3);
  });
});

// ─── Regex Pattern ────────────────────────────────────────────────────────────

describe("Schema Flexibility — Regex pattern constraint", () => {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  it("returns data when output matches regex pattern", async () => {
    const model = mockModel("2024-06-25");
    const result = await generate(model, { pattern: datePattern }, "get a date");
    expect(result.data).toBe("2024-06-25");
  });

  it("throws MaxRetriesExceededError when output does not match pattern", async () => {
    const model = mockModel("not-a-date");
    await expect(
      generate(model, { pattern: datePattern }, "get a date", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("accepts any string matching a simple pattern", async () => {
    const model = mockModel("abc123");
    const result = await generate(model, { pattern: /^[a-z]+\d+$/ }, "get alphanumeric");
    expect(result.data).toBe("abc123");
  });
});

// ─── Custom Validator ─────────────────────────────────────────────────────────

describe("Schema Flexibility — Custom validator function", () => {
  it("returns data when custom validator returns true", async () => {
    const model = mockModel({ id: "abc", value: 42 });
    const result = await generate(
      model,
      { validate: (x: unknown) => typeof (x as any).id === "string" },
      "get object with id"
    );
    expect((result.data as any).id).toBe("abc");
  });

  it("throws MaxRetriesExceededError when custom validator returns false", async () => {
    const model = mockModel({ value: 42 });
    await expect(
      generate(
        model,
        { validate: (x: unknown) => (x as any).id !== undefined },
        "get object with id",
        { maxRetries: 2 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("passes the raw output to the validator", async () => {
    const seen: unknown[] = [];
    const model = mockModel([1, 2, 3]);
    await generate(
      model,
      {
        validate: (x: unknown) => {
          seen.push(x);
          return Array.isArray(x) && (x as number[]).length === 3;
        },
      },
      "get array"
    );
    expect(seen[0]).toEqual([1, 2, 3]);
  });
});
