/**
 * Example: Local model via Ollama (true token-level constraint)
 * Requires: ollama running locally with a model pulled
 * Setup: ollama pull llama3.2
 */
import { z } from "zod";
import { generate, ollama } from "@aviasole/shapecraft";

const ProductSchema = z.object({
  name: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
  tags: z.array(z.string()),
});

// No API key needed — runs fully local
const model = ollama({ model: "llama3.2" });

const result = await generate(
  model,
  ProductSchema,
  "Extract product: Blue wireless headphones, $49.99, available, tags: audio electronics bluetooth"
);

console.log(result.data);
// { name: "Blue wireless headphones", price: 49.99, inStock: true, tags: ["audio", "electronics", "bluetooth"] }
console.log(result.guaranteeLevel); // "constrained" — token-level guarantee
