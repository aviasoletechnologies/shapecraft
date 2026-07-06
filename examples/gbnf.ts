/**
 * Example: Raw GBNF grammar input.
 *
 * On a llama.cpp-family backend (`llamaCpp()`) the grammar is applied at the
 * token level — the output is valid by construction (`constrained`). On any
 * other backend the grammar is injected into the prompt (best-effort) and the
 * returned string is validated against the grammar by shapecraft's bundled
 * GBNF interpreter. Output is always the raw matched string.
 */
import { generate, openai, llamaCpp } from "@aviasole/shapecraft";

// A grammar for an ISO date.
const dateGrammar = `
root  ::= year "-" month "-" day
year  ::= [0-9]{4}
month ::= [0-9]{2}
day   ::= [0-9]{2}
`;

// A grammar for a fixed enum (classification).
const sentimentGrammar = `root ::= "positive" | "negative" | "neutral"`;

// ── Best-effort on a cloud backend (prompt + validate) ────────────────────────
const gpt = openai({ model: "gpt-4o-mini" });

const date = await generate(gpt, { gbnf: dateGrammar }, "When did WWII end in Europe?");
console.log(date.data); // "1945-05-08"
console.log(date.guaranteeLevel); // "best-effort" is the *effective* guarantee here

// ── Token-level constraint on a local model (valid by construction) ───────────
// Requires: npm install node-llama-cpp, and a local .gguf model file.
const local = llamaCpp({ modelPath: "./models/llama-3.2-3b-instruct.gguf" });

const sentiment = await generate(
  local,
  { gbnf: sentimentGrammar },
  "Classify the sentiment: 'I absolutely love this product!'"
);
console.log(sentiment.data); // "positive" — the model literally cannot emit anything else
console.log(sentiment.guaranteeLevel); // "constrained"
