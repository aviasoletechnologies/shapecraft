import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate.js";
import { buildYamlSystemPrompt, finalizeYamlOutput } from "../src/core/yaml.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../src/types.js";
import type { YamlInput, ShapecraftModel } from "../src/types.js";

const personSchema: YamlInput = {
  yaml: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    },
  },
};

// ─── buildYamlSystemPrompt ─────────────────────────────────────────────────

describe("buildYamlSystemPrompt", () => {
  it("embeds the JSON Schema hint and asks for YAML", () => {
    const prompt = buildYamlSystemPrompt(personSchema);
    expect(prompt).toContain("valid YAML");
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"age"');
  });
});

// ─── finalizeYamlOutput ─────────────────────────────────────────────────────

describe("finalizeYamlOutput", () => {
  it("parses valid YAML and returns the object by default", () => {
    const result = finalizeYamlOutput("name: John Doe\nage: 32\n", personSchema);
    expect(result).toEqual({ name: "John Doe", age: 32 });
  });

  it("strips a ```yaml markdown fence before parsing", () => {
    const result = finalizeYamlOutput("```yaml\nname: John Doe\nage: 32\n```", personSchema);
    expect(result).toEqual({ name: "John Doe", age: 32 });
  });

  it("returns the raw YAML string when parse: false", () => {
    const schema: YamlInput = { yaml: { ...personSchema.yaml, parse: false } };
    const result = finalizeYamlOutput("name: John Doe\nage: 32", schema);
    expect(result).toBe("name: John Doe\nage: 32");
  });

  it("throws SchemaViolationError on malformed YAML", () => {
    expect(() => finalizeYamlOutput("name: [unclosed", personSchema)).toThrow(SchemaViolationError);
  });

  it("throws SchemaViolationError when a required field is missing", () => {
    expect(() => finalizeYamlOutput("name: John Doe\n", personSchema)).toThrow(SchemaViolationError);
  });

  it("throws SchemaViolationError on a type mismatch", () => {
    expect(() => finalizeYamlOutput("name: John Doe\nage: thirty-two\n", personSchema)).toThrow(
      SchemaViolationError
    );
  });
});

// ─── generate() with YAML schema — mock model ───────────────────────────────

describe("generate() with YAML schema — mock model", () => {
  it("returns the parsed object on a valid response", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "name: Jane Doe\nage: 29\n" as T;
      },
    };

    const result = await generate(model, personSchema, "Extract: Jane Doe, 29");
    expect(result.data).toEqual({ name: "Jane Doe", age: 29 });
    expect(result.guaranteeLevel).toBe("best-effort");
  });

  // Mandatory check 1: wrong-format input — model output is well-formed YAML
  // but doesn't conform to the requested schema (wrong type on a field).
  it("wrong-format input: retries and throws MaxRetriesExceededError on a schema-violating response", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "name: Jane Doe\nage: not-a-number\n" as T;
      },
    };

    await expect(generate(model, personSchema, "Extract: Jane Doe, 29", { maxRetries: 2 })).rejects.toThrow(
      MaxRetriesExceededError
    );
  });

  // Mandatory check 2: an unrelated prompt/schema pairing — the model ignores
  // the schema entirely and returns content that has nothing to do with it.
  it("unrelated prompt: retries and throws MaxRetriesExceededError when output has no relation to the schema", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "weather: sunny\ntemperature: 72\n" as T;
      },
    };

    await expect(
      generate(model, personSchema, "What's the weather like today?", { maxRetries: 2 })
    ).rejects.toThrow(MaxRetriesExceededError);
  });
});
