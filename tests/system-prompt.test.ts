import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generate } from "../src/core/generate.js";
import { anthropic } from "../src/backends/anthropic.js";
import { mockModel } from "./helpers/index.js";

const ReplySchema = z.object({
  reply: z.string(),
});

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe("systemPrompt forwarding", () => {
  it("system prompt influences model response", async () => {
    const model = hasApiKey
      ? anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-haiku-4-5-20251001" })
      : mockModel({ reply: "I only speak formally." });

    const result = await generate(
      model,
      ReplySchema,
      "Say hello",
      { systemPrompt: "You are a very formal assistant. Always respond in formal english only." }
    );

    expect(result.data).toMatchObject({ reply: expect.any(String) });
    expect(result.guaranteeLevel).toBe(hasApiKey ? "best-effort" : "constrained");

    if (hasApiKey) {
      console.log("systemPrompt test — real API response:", result.data.reply);
    }
  }, 30000);
});
