import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { openai } from "../src/backends/openai.js";
import { groq } from "../src/backends/groq.js";
import { anthropic } from "../src/backends/anthropic.js";
import { ollama } from "../src/backends/ollama.js";
import { fireworks } from "../src/backends/fireworks.js";
import { mistral } from "../src/backends/mistral.js";
import { openRouter } from "../src/backends/openRouter.js";
import { gemini } from "../src/backends/gemini.js";
import { mockModel } from "./helpers/index.js";

const PersonSchema = z.object({ name: z.string(), age: z.number() });

describe("ShapecraftModel.capabilities", () => {
  it.each([
    ["openai", openai({ model: "gpt-4o-mini" })],
    ["groq", groq({ model: "llama-3.3-70b-versatile" })],
    ["anthropic", anthropic({ model: "claude-haiku-4-5-20251001" })],
    ["ollama", ollama({ model: "llama3.2" })],
    ["fireworks", fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" })],
    ["mistral", mistral({ model: "mistral-large-latest" })],
    ["openRouter", openRouter({ model: "openai/gpt-4o-mini" })],
    ["gemini", gemini({ model: "gemini-flash-latest" })],
  ])("%s exposes streaming/chat/structuredOutput/skillDispatch true, toolCalling false", (_name, model) => {
    expect(model.capabilities).toEqual({
      streaming: true,
      chat: true,
      structuredOutput: true,
      toolCalling: false,
      skillDispatch: true,
    });
  });

  it.each([
    ["openai", openai({ model: "gpt-4o-mini" })],
    ["groq", groq({ model: "llama-3.3-70b-versatile" })],
    ["anthropic", anthropic({ model: "claude-haiku-4-5-20251001" })],
    ["ollama", ollama({ model: "llama3.2" })],
    ["fireworks", fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" })],
    ["mistral", mistral({ model: "mistral-large-latest" })],
    ["openRouter", openRouter({ model: "openai/gpt-4o-mini" })],
    ["gemini", gemini({ model: "gemini-flash-latest" })],
  ])("%s's declared capabilities match its actual duck-typed method presence", (_name, model) => {
    expect(model.capabilities?.streaming).toBe(typeof model.generateStream === "function");
    expect(model.capabilities?.chat).toBe(typeof model.chat === "function");
  });

  it("openRouter() reports best-effort, not native - pass-through across many underlying models means json_schema enforcement isn't guaranteed for all of them", () => {
    expect(openRouter({ model: "openai/gpt-4o-mini" }).guaranteeLevel).toBe("best-effort");
  });

  it("gemini() reports native - responseSchema/responseJsonSchema is server-side constrained decoding, same tier as openai()/groq()", () => {
    expect(gemini({ model: "gemini-flash-latest" }).guaranteeLevel).toBe("native");
  });

  it("is optional — a pre-existing custom ShapecraftModel without capabilities still satisfies the interface and works", async () => {
    const legacy = mockModel({ name: "Alice", age: 30 });
    expect(legacy.capabilities).toBeUndefined();

    const result = await generate(legacy, PersonSchema, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
  });
});

const hasMistral = !!process.env.MISTRAL_API_KEY;

// Regression guard: caught live while dogfood-testing mistral() - despite
// response_format: { type: "json_schema" } supposedly enforcing raw JSON,
// mistral-large-latest sometimes wraps the output in a ```json fence anyway.
// Without extractJson: true in mistral.ts's generate(), that fails JSON.parse
// outright and burns all 3 retries before MaxRetriesExceededError.
describe("Mistral backend (real API)", () => {
  it.skipIf(!hasMistral)("survives a markdown-fence-wrapped json_schema response", async () => {
    const model = mistral({ model: "mistral-large-latest" });
    const result = await generate(
      model,
      z.object({ name: z.string(), age: z.number(), email: z.string() }),
      "Jane Doe is 34 years old, email jane.doe@example.com"
    );
    expect(result.data).toEqual({ name: "Jane Doe", age: 34, email: "jane.doe@example.com" });
  }, 30_000);
});
