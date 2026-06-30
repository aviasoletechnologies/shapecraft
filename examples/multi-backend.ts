/**
 * Example: Same schema, different backends — unified API
 */
import { z } from "zod";
import { generate, openai, groq, anthropic, ollama } from "@aviasole/shapecraft";

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

const prompt = "Analyze sentiment: 'The product exceeded my expectations, truly outstanding!'";

// Pick any backend — same call, same output shape
const backends = [
  openai({ model: "gpt-4o-mini" }),         // native
  groq({ model: "llama-3.3-70b-versatile" }), // native (fast)
  anthropic({ model: "claude-haiku-4-5-20251001" }), // best-effort
  // ollama({ model: "llama3.2" }),           // constrained (local)
];

for (const model of backends) {
  const result = await generate(model, SentimentSchema, prompt);
  console.log(`[${model.id}] guarantee=${result.guaranteeLevel}`);
  console.log(result.data);
}
