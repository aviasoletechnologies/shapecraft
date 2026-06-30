/**
 * Example: Custom validator — full control over output validation
 */
import { generate, openai } from "@aviasole/shapecraft";

const model = openai({ model: "gpt-4o-mini" });

const result = await generate(
  model,
  {
    validate: (output): output is { id: string; score: number } =>
      typeof output === "object" &&
      output !== null &&
      typeof (output as any).id === "string" &&
      typeof (output as any).score === "number" &&
      (output as any).score >= 0 &&
      (output as any).score <= 100,
    hint: {
      type: "object",
      properties: {
        id: { type: "string" },
        score: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["id", "score"],
    },
  },
  "Generate a test result for user abc123 with score 87"
);

console.log(result.data); // { id: "abc123", score: 87 }
