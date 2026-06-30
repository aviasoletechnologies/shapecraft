/**
 * Example: Zod schema (recommended for type safety)
 */
import { z } from "zod";
import { generate, openai } from "@aviasole/shapecraft";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
  email: z.string().email(),
});

const model = openai({ model: "gpt-4o-mini" });

const result = await generate(model, PersonSchema, "Extract: John Doe, 32, john@example.com");

console.log(result.data);           // { name: "John Doe", age: 32, email: "john@example.com" }
console.log(result.guaranteeLevel); // "native"
console.log(result.attempts);       // 1
