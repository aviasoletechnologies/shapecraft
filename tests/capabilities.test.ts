import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { openai } from "../src/backends/openai.js";
import { groq } from "../src/backends/groq.js";
import { anthropic } from "../src/backends/anthropic.js";
import { ollama } from "../src/backends/ollama.js";
import { mockModel } from "./helpers/index.js";

const PersonSchema = z.object({ name: z.string(), age: z.number() });

describe("ShapecraftModel.capabilities", () => {
  it.each([
    ["openai", openai({ model: "gpt-4o-mini" })],
    ["groq", groq({ model: "llama-3.3-70b-versatile" })],
    ["anthropic", anthropic({ model: "claude-haiku-4-5-20251001" })],
    ["ollama", ollama({ model: "llama3.2" })],
  ])("%s exposes streaming/chat/structuredOutput true, toolCalling false", (_name, model) => {
    expect(model.capabilities).toEqual({
      streaming: true,
      chat: true,
      structuredOutput: true,
      toolCalling: false,
    });
  });

  it.each([
    ["openai", openai({ model: "gpt-4o-mini" })],
    ["groq", groq({ model: "llama-3.3-70b-versatile" })],
    ["anthropic", anthropic({ model: "claude-haiku-4-5-20251001" })],
    ["ollama", ollama({ model: "llama3.2" })],
  ])("%s's declared capabilities match its actual duck-typed method presence", (_name, model) => {
    expect(model.capabilities?.streaming).toBe(typeof model.generateStream === "function");
    expect(model.capabilities?.chat).toBe(typeof model.chat === "function");
  });

  it("is optional — a pre-existing custom ShapecraftModel without capabilities still satisfies the interface and works", async () => {
    const legacy = mockModel({ name: "Alice", age: 30 });
    expect(legacy.capabilities).toBeUndefined();

    const result = await generate(legacy, PersonSchema, "get person");
    expect(result.data).toEqual({ name: "Alice", age: 30 });
  });
});
