/**
 * Example: cost aggregation — running total across multiple generate() calls.
 *
 * shapecraft doesn't compute $ amounts itself (no built-in per-model pricing
 * tables - those go stale the moment a provider changes rates). You supply
 * the cost per call from your own pricing logic; createCostTracker() just
 * sums what you give it.
 */
import { generate, createClient, createCostTracker, costTrackingMiddleware, openai } from "@aviasole/shapecraft";

const model = openai({ model: "gpt-4o-mini" });
const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// gpt-4o-mini's real per-token pricing, as of this writing - your own rates
// live here, shapecraft has no opinion on what a token costs.
const PRICE_PER_1K_INPUT = 0.00015;
const PRICE_PER_1K_OUTPUT = 0.0006;

function costOf(tokens: { input: number; output: number } | undefined): number {
  if (!tokens) return 0;
  return (tokens.input / 1000) * PRICE_PER_1K_INPUT + (tokens.output / 1000) * PRICE_PER_1K_OUTPUT;
}

// ── Manual: call tracker.record() yourself after each direct generate() ─────
const tracker = createCostTracker();

const r1 = await generate(model, schema, "Extract: Jane Doe, 28");
tracker.record(costOf(r1.metadata.tokens));

const r2 = await generate(model, schema, "Extract: John Smith, 41");
tracker.record(costOf(r2.metadata.tokens));

console.log(`Spent $${tracker.total.toFixed(6)} across ${tracker.calls} calls`);

// ── Automatic: wire it into createClient() and every call tracks itself ─────
const autoTracker = createCostTracker();
const client = createClient({
  middleware: [costTrackingMiddleware(autoTracker, (result) => costOf(result.metadata.tokens))],
});

await client.generate(model, schema, "Extract: Ada Lovelace, 36");
await client.generate(model, schema, "Extract: Grace Hopper, 85");

console.log(`Spent $${autoTracker.total.toFixed(6)} across ${autoTracker.calls} calls`);
