/**
 * Example: OpenAPI-spec-driven schema.
 *
 * Point at an operationId in an existing OpenAPI 3.x spec instead of hand-writing
 * a JSON Schema — shapecraft derives it from the spec's requestBody (default) or
 * response schema. From here on it behaves exactly like a `{ jsonSchema }` input.
 */
import { generate, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

// spec can be a file path, a URL, or an already-parsed object
const result = await generate(
  model,
  {
    openapi: {
      spec: "./openapi.yaml",
      operationId: "createUser",
      // target: "requestBody" is the default — pass target: "response" to
      // derive from the success response schema instead
    },
  },
  "A user named Jane Doe, age 29, admin role"
);
console.log(result.data);
