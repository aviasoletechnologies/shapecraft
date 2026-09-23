import { describe, it, expect } from "vitest";
import fixtureSpec from "./fixtures/openapi-spec.json" with { type: "json" };
import { resolveOpenApiSchema } from "../src/core/openapi.js";
import { generate } from "../src/core/generate.js";
import { MaxRetriesExceededError } from "../src/types.js";
import type { OpenApiInput, ShapecraftModel } from "../src/types.js";

// ─── resolveOpenApiSchema ────────────────────────────────────────────────────

describe("resolveOpenApiSchema", () => {
  it("resolves a requestBody schema by operationId (default target)", async () => {
    const result = await resolveOpenApiSchema({
      openapi: { spec: fixtureSpec, operationId: "createUser" },
    });
    expect(result.jsonSchema).toMatchObject({
      type: "object",
      required: ["name", "age"],
    });
  });

  it("resolves a response schema by operationId when target: 'response'", async () => {
    const result = await resolveOpenApiSchema({
      openapi: { spec: fixtureSpec, operationId: "getUser", target: "response" },
    });
    expect(result.jsonSchema).toMatchObject({
      type: "object",
      required: ["id", "name"],
    });
  });

  it("throws immediately if the operationId doesn't exist in the spec", async () => {
    await expect(
      resolveOpenApiSchema({ openapi: { spec: fixtureSpec, operationId: "deleteEverything" } })
    ).rejects.toThrow(/operationId "deleteEverything" not found/);
  });

  it("throws immediately if the operation has no schema on the requested target", async () => {
    await expect(
      resolveOpenApiSchema({ openapi: { spec: fixtureSpec, operationId: "healthCheck", target: "response" } })
    ).rejects.toThrow(/no application\/json response schema/);
  });

  it("throws immediately if requesting a requestBody target on an operation with none", async () => {
    await expect(
      resolveOpenApiSchema({ openapi: { spec: fixtureSpec, operationId: "getUser" } })
    ).rejects.toThrow(/no application\/json requestBody schema/);
  });
});

// ─── generate() with an openapi schema — mock model ─────────────────────────

const createUserInput: OpenApiInput = {
  openapi: { spec: fixtureSpec, operationId: "createUser" },
};

describe("generate() with openapi schema — mock model", () => {
  it("resolves the spec, then behaves exactly like a jsonSchema input", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return { name: "Jane Doe", age: 29 } as T;
      },
    };

    const result = await generate(model, createUserInput, "Extract: Jane Doe, 29");
    expect(result.data).toEqual({ name: "Jane Doe", age: 29 });
  });

  // Mandatory check 1: wrong-format input — well-formed JSON that violates
  // the resolved schema's types.
  it("wrong-format input: retries and throws MaxRetriesExceededError on a schema-violating response", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return { name: "Jane Doe", age: "not-a-number" } as T;
      },
    };

    await expect(
      generate(model, createUserInput, "Extract: Jane Doe, 29", { maxRetries: 2 })
    ).rejects.toThrow(MaxRetriesExceededError);
  });

  // Mandatory check 2: an unrelated prompt/schema pairing.
  it("unrelated prompt: retries and throws MaxRetriesExceededError when output has no relation to the schema", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return { weather: "sunny", temperature: 72 } as T;
      },
    };

    await expect(
      generate(model, createUserInput, "What's the weather like today?", { maxRetries: 2 })
    ).rejects.toThrow(MaxRetriesExceededError);
  });

  it("propagates an unresolvable operationId immediately, without ever calling the model", async () => {
    let called = false;
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        called = true;
        return "{}" as T;
      },
    };

    await expect(
      generate(model, { openapi: { spec: fixtureSpec, operationId: "nope" } }, "Extract: Jane Doe, 29")
    ).rejects.toThrow(/operationId "nope" not found/);
    expect(called).toBe(false);
  });
});

