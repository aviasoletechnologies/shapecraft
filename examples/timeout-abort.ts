/**
 * Example: timeoutMs / signal — bounding and cancelling a single attempt.
 *
 * Enforced at the core level for every backend: the retry loop always stops
 * waiting once the timeout/signal fires, even against a backend that ignores
 * cancellation entirely. All four built-in backends additionally forward the
 * signal to the underlying SDK/fetch call for real request cancellation, not
 * just abandonment.
 */
import { generate, groq, TimeoutError } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// ── timeoutMs: bound a single attempt's wall-clock time ──────────────────────
try {
  const result = await generate(model, schema, "Extract: Jane Doe, 28", { timeoutMs: 5_000 });
  console.log(result.data);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error(`Timed out after ${err.timeoutMs}ms`);
  } else {
    throw err;
  }
}

// ── signal: cancel an in-flight attempt from the outside ────────────────────
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error("user navigated away")), 5_000);

try {
  const result = await generate(model, schema, "Extract: John Smith, 41", { signal: controller.signal });
  clearTimeout(timer);
  console.log(result.data);
} catch (err) {
  clearTimeout(timer);
  if (err instanceof Error && err.name === "AbortError") {
    console.error("Cancelled:", err.message);
  } else {
    throw err;
  }
}

// ── timeoutMs and signal can be combined — whichever fires first wins ───────
const result = await generate(model, schema, "Extract: Ada Lovelace, 36", {
  timeoutMs: 10_000,
  signal: controller.signal,
});
console.log(result.data);
