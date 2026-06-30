/**
 * Example: Regex pattern — force model to return string matching pattern
 */
import { generate, openai } from "@aviasole/shapecraft";

const model = openai({ model: "gpt-4o-mini" });

// Extract ISO date
const dateResult = await generate(
  model,
  { pattern: /^\d{4}-\d{2}-\d{2}$/ },
  "What date is Christmas 2025? Return only the date."
);
console.log(dateResult.data); // "2025-12-25"

// Extract phone number
const phoneResult = await generate(
  model,
  { pattern: /^\+1-\d{3}-\d{3}-\d{4}$/ },
  "Format this as US phone: 555 867 5309"
);
console.log(phoneResult.data); // "+1-555-867-5309"
