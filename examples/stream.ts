/**
 * Example: generateStream — streamed structured output.
 *
 * Tokens stream live for UX, but validation still happens exactly once, on
 * the fully assembled response — streaming is purely a transport layer over
 * the same pipeline as non-streaming generate(). For JSON/Zod object
 * schemas, each top-level field is ALSO validated the moment its own JSON
 * closes (before the whole object is done), via "partial" events — so a UI
 * can render fields as they arrive, already validated.
 */
import { generateStream, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age", "email"],
    properties: {
      name: { type: "string" },
      age: { type: "number" },
      email: { type: "string" },
    },
  },
};

// ── Simple: just show tokens, then get the validated object ─────────────────
const stream = generateStream(model, schema, "Extract: Jane Doe, 28, jane@example.com");

for await (const delta of stream.textStream) {
  process.stdout.write(delta);
}

const { data, attempts, guaranteeLevel } = await stream.result;
console.log("\n", { data, attempts, guaranteeLevel });
// { data: { name: "Jane Doe", age: 28, email: "jane@example.com" }, attempts: 1, guaranteeLevel: "best-effort" }

// ── Richer: react to lifecycle events, including incremental field validation ─
const stream2 = generateStream(model, schema, "Extract: John Smith, 41, john@example.com");

for await (const event of stream2.events) {
  switch (event.type) {
    case "attempt-start":
      console.log(`\n--- attempt ${event.attempt} ---`);
      break;
    case "delta":
      process.stdout.write(event.text);
      break;
    case "partial":
      // Fires the instant each top-level field closes, already validated
      // against its own sub-schema — no need to wait for the whole object.
      console.log("\npartial so far:", event.value);
      break;
    case "attempt-failed":
      console.log(`\nattempt ${event.attempt} failed validation, retrying...`);
      break;
    case "done":
      console.log("\ndone:", event.result.data);
      break;
  }
}
