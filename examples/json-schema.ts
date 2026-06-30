/**
 * Example: Raw JSON Schema (no Zod dependency needed)
 */
import { generate, openai } from "@aviasole/shapecraft";

const model = openai({ model: "gpt-4o-mini" });

const result = await generate(
  model,
  {
    jsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        year: { type: "number" },
        genres: { type: "array", items: { type: "string" } },
      },
      required: ["title", "year", "genres"],
    },
  },
  "Extract movie info: The Dark Knight, 2008, action/crime/drama"
);

console.log(result.data);
// { title: "The Dark Knight", year: 2008, genres: ["action", "crime", "drama"] }
