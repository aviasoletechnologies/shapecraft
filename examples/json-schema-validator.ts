/**
 * Example: jsonSchemaValidator — pluggable structural validation.
 *
 * The built-in `jsonSchema` check (checkJsonSchema) is intentionally shallow:
 * it validates types and `required` presence, not minLength/maximum/pattern/
 * $ref/etc. Rather than expanding it, it's pluggable — supply your own
 * validator (or wire up AJV) instead of the default.
 */
import { generate, groq } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const PersonJsonSchema = {
  type: "object",
  required: ["name", "age"],
  properties: { name: { type: "string" }, age: { type: "number" } },
};

// ── Default behavior: only types + required are checked ─────────────────────
const loose = await generate(model, { jsonSchema: PersonJsonSchema }, "Extract: Jo, 200");
console.log(loose.data); // { name: "Jo", age: 200 } — accepted; nothing in the schema forbids this

// ── A stricter validator: throw to reject, return normally to accept ────────
//
// Like the built-in checkJsonSchema, this gets called at TWO different
// scopes, and must handle both: once with the whole object (generate()'s
// final check), and once per top-level field with just that field's own raw
// value (generateStream()'s incremental "partial" check, in incremental.ts).
// A validator that assumes "value is always the whole object" will wrongly
// reject valid streamed fields, since e.g. the "name" field arrives here as
// value = "Jane Doe" (a bare string), not { name: "Jane Doe", ... }.
function strictValidator(value: unknown, schema: Record<string, unknown>): void {
  if (typeof value === "string" && schema.type === "string" && value.length < 3) {
    throw new Error("name must be a string of at least 3 characters");
  }
  if (typeof value === "number" && schema.type === "number" && (value < 0 || value > 130)) {
    throw new Error("age must be a plausible human age (0-130)");
  }
  if (typeof value === "object" && value !== null) {
    const v = value as { name?: string; age?: number };
    if (typeof v.name === "string" && v.name.length < 3) {
      throw new Error("name must be a string of at least 3 characters");
    }
    if (typeof v.age === "number" && (v.age < 0 || v.age > 130)) {
      throw new Error("age must be a plausible human age (0-130)");
    }
  }
}

try {
  await generate(model, { jsonSchema: PersonJsonSchema }, "Extract: Jo, 200", {
    jsonSchemaValidator: strictValidator,
    maxRetries: 2,
  });
} catch {
  console.log("rejected: name/age fail the stricter rules on every retry");
}

// ── Applies to generateStream()'s per-field `partial` validation too ────────
import { generateStream } from "@aviasole/shapecraft";

const stream = generateStream(model, { jsonSchema: PersonJsonSchema }, "Extract: Jane Doe, 28", {
  jsonSchemaValidator: strictValidator,
});

for await (const event of stream.events) {
  if (event.type === "partial") console.log("field validated against strictValidator:", event.value);
}

console.log((await stream.result).data); // { name: "Jane Doe", age: 28 }
