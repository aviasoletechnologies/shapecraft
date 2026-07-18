/**
 * Example: retryDelayMs — waiting between retries instead of firing immediately.
 *
 * Retries fire immediately by default. Against a rate-limited API, an instant
 * retry just hits the same limit again — retryDelayMs lets you back off instead.
 */
import { generate, groq, exponentialBackoff } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// ── exponentialBackoff(): 200ms, 400ms, 800ms, ... jittered, capped at 10s ──
const result = await generate(model, schema, "Extract: Jane Doe, 28", {
  maxRetries: 4,
  retryDelayMs: exponentialBackoff(),
});
console.log(result.data);

// ── a fixed delay is also fine ───────────────────────────────────────────────
await generate(model, schema, "Extract: John Smith, 41", {
  maxRetries: 3,
  retryDelayMs: 500, // wait 500ms before every retry
});

// ── or a custom function — called with the attempt number that just failed ──
await generate(model, schema, "Extract: Ada Lovelace, 36", {
  maxRetries: 3,
  retryDelayMs: (attempt) => attempt * 250, // 250ms, 500ms, ...
});

// ── exponentialBackoff() options ─────────────────────────────────────────────
const conservativeBackoff = exponentialBackoff({
  baseMs: 500,
  factor: 3,
  maxMs: 30_000,
  jitter: true, // default - randomizes each delay in [0, computed]
});
await generate(model, schema, "Extract: Grace Hopper, 85", {
  maxRetries: 5,
  retryDelayMs: conservativeBackoff,
});
