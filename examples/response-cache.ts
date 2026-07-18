/**
 * Example: responseCacheMiddleware — skip the model call entirely on a
 * repeated (model + schema + prompt + systemPrompt) request.
 *
 * Built entirely on createClient()'s existing middleware seam - a cache hit
 * short-circuits the chain (never calls next()), so no retries/latency/cost
 * on repeated calls within ttlMs.
 */
import { createClient, responseCacheMiddleware, groq } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

const client = createClient({
  middleware: [responseCacheMiddleware({ ttlMs: 5 * 60_000 })], // 5 minutes
});

const r1 = await client.generate(model, schema, "Extract: Jane Doe, 28"); // real call
console.log(r1.data, r1.metadata.latencyMs);

const r2 = await client.generate(model, schema, "Extract: Jane Doe, 28"); // cache hit
console.log(r2.data, r2.metadata.latencyMs); // same data, same metadata as r1 - no model call happened

// ── a different prompt is a cache miss, same as a different schema/model ────
const r3 = await client.generate(model, schema, "Extract: John Smith, 41"); // real call
console.log(r3.data);
