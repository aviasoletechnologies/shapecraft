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

// Replace this estimate with usage/cost from your own billing source.
// Shapecraft does not populate result.metadata.tokens yet.
const estimatedCostPerCall = 0.001;

// ── Manual: call tracker.record() yourself after each direct generate() ─────
const tracker = createCostTracker();

await generate(model, schema, "Extract: Jane Doe, 28");
tracker.record(estimatedCostPerCall);

await generate(model, schema, "Extract: John Smith, 41");
tracker.record(estimatedCostPerCall);

console.log(`Estimated $${tracker.total.toFixed(6)} across ${tracker.calls} calls`);

// ── Automatic: wire it into createClient() and every call tracks itself ─────
const autoTracker = createCostTracker();
const client = createClient({
  middleware: [costTrackingMiddleware(autoTracker, () => estimatedCostPerCall)],
});

await client.generate(model, schema, "Extract: Ada Lovelace, 36");
await client.generate(model, schema, "Extract: Grace Hopper, 85");

console.log(`Estimated $${autoTracker.total.toFixed(6)} across ${autoTracker.calls} calls`);
