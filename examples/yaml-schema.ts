/**
 * Example: YAML output.
 *
 * You describe the target shape as a JSON Schema, and the model responds in
 * YAML instead of JSON. By default `result.data` is the parsed object;
 * add `parse: false` to get the raw YAML string back instead.
 */
import { generate, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

// ── Default: parsed object back ──────────────────────────────────────────────
const person = await generate(
  model,
  {
    yaml: {
      schema: {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name", "age"],
      },
    },
  },
  "Extract: John Doe, 32 years old."
);
console.log(person.data); // { name: "John Doe", age: 32 }

// ── parse: false → raw YAML string ───────────────────────────────────────────
const config = await generate(
  model,
  {
    yaml: {
      schema: {
        type: "object",
        properties: {
          replicas: { type: "number" },
          image: { type: "string" },
        },
        required: ["replicas", "image"],
      },
      parse: false,
    },
  },
  "A deployment config with 3 replicas running nginx:latest"
);
console.log(config.data);
// "replicas: 3\nimage: nginx:latest\n"
