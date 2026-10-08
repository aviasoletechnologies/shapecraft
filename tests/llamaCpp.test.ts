import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SchemaInput } from "../src/types.js";

const llamaMocks = vi.hoisted(() => ({
  jsonGrammar: { kind: "json-schema-grammar" },
  promptOptions: undefined as unknown,
  createGrammarForJsonSchema: vi.fn(async (_schema: unknown) => llamaMocks.jsonGrammar),
  prompt: vi.fn(async (_text: string, options: unknown) => {
    llamaMocks.promptOptions = options;
    return '{"name":"Ada"}';
  }),
}));

vi.mock("node-llama-cpp", () => ({
  getLlama: async () => ({
    loadModel: async () => ({
      createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }),
    }),
    createGrammarForJsonSchema: llamaMocks.createGrammarForJsonSchema,
    createGrammar: async () => ({ kind: "gbnf-grammar" }),
  }),
  LlamaChatSession: class {
    async prompt(text: string, options: unknown) {
      return llamaMocks.prompt(text, options);
    }
  },
}));

describe("llamaCpp JSON Schema grammar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function assertConstrained(schema: SchemaInput, expectedSchema: unknown) {
    const { llamaCpp } = await import("../src/backends/llamaCpp.js");
    const backend = llamaCpp({ modelPath: "test.gguf" });
    const result = await backend.generate("extract", schema);

    expect(result).toEqual({ name: "Ada" });
    expect(llamaMocks.createGrammarForJsonSchema).toHaveBeenCalledOnce();
    expect(llamaMocks.createGrammarForJsonSchema.mock.calls[0][0]).toMatchObject(expectedSchema);
    expect(llamaMocks.promptOptions).toEqual({ grammar: llamaMocks.jsonGrammar });
  }

  it("converts Zod schemas and constrains generation", async () => {
    await assertConstrained(z.object({ name: z.string() }), {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  }, 15_000);

  it("constrains raw JSON Schema generation", async () => {
    const jsonSchema = { type: "object", properties: { name: { type: "string" } } };
    await assertConstrained({ jsonSchema }, jsonSchema);
  }, 15_000);
});
