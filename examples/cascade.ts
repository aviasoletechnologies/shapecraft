/**
 * Example: cascade() — start with a cheap model, escalate to a stronger one
 * only when the cheap one fails.
 *
 * Most calls (the easy ones) never touch the expensive model at all - you only
 * pay for it on the cases that actually needed it. Works via GenerateOptions'
 * existing retry loop: no new core primitive, just a ShapecraftModel that
 * delegates to a different underlying model once it's failed enough times.
 */
import { generate, cascade, groq, anthropic } from "@aviasole/shapecraft";

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// ── Default: escalate on the very first failure ──────────────────────────────
const model = cascade([
  groq({ model: "llama-3.3-70b-versatile" }), // cheap/fast, tried first
  anthropic({ model: "claude-sonnet-4-5" }), // stronger fallback
]);

const result = await generate(model, schema, "Extract: Jane Doe, 28", { maxRetries: 4 });
console.log(result.data);
console.log(result.metadata.provider); // "groq" if it succeeded on attempt 1, "anthropic" if it escalated

// ── give the cheap model a couple of tries before escalating ────────────────
const patientCascade = cascade(
  [groq({ model: "llama-3.3-70b-versatile" }), anthropic({ model: "claude-sonnet-4-5" })],
  { escalateAfterFailures: 2 }
);
await generate(patientCascade, schema, "Extract: John Smith, 41", { maxRetries: 4 });

// ── a three-model cascade escalates one step at a time, capping at the last ─
const threeTier = cascade([
  groq({ model: "llama-3.3-70b-versatile" }),
  groq({ model: "llama-3.3-70b-versatile" }), // stand-in for a mid-tier model
  anthropic({ model: "claude-sonnet-4-5" }),
]);
await generate(threeTier, schema, "Extract: Ada Lovelace, 36", { maxRetries: 6 });
