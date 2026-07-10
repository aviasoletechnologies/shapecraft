/**
 * Example: generateBatch() - parallel generation across multiple prompts.
 *
 * Runs each item independently (own model/schema/prompt/options), capped at
 * `concurrency` in flight at once (uncapped if omitted). Never throws on a
 * single item's failure - each settles independently, Promise.allSettled-style.
 */
import { generateBatch, createClient, groq } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// ── Standalone: same as calling generate() N times, just parallelized ───────
const results = await generateBatch(
  [
    { model, schema, prompt: "Extract: Jane Doe, 28" },
    { model, schema, prompt: "Extract: John Smith, 41" },
    { model, schema, prompt: "Extract: Ada Lovelace, 36" },
  ],
  { concurrency: 2 }
);

for (const r of results) {
  if (r.status === "fulfilled") console.log("ok:", r.value.data);
  else console.error("failed:", r.reason);
}

// ── Through createClient(): each item still gets middleware + client defaults ─
const client = createClient({ retry: { max: 3 }, timeoutMs: 10_000 });

const batchResults = await client.generateBatch([
  { model, schema, prompt: "Extract: Jane Doe, 28" },
  { model, schema, prompt: "Extract: John Smith, 41" },
]);

console.log(batchResults.map((r) => (r.status === "fulfilled" ? r.value.data : r.reason)));
