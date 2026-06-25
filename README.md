# @aviasole/shapecraft

Structured output generation for LLMs in Node.js. Token-level constraints for local models, native JSON modes for cloud APIs — one unified Zod API.

## Install

```bash
npm install @aviasole/shapecraft zod
```

Install backend SDK as needed:

```bash
npm install openai          # OpenAI
npm install groq-sdk        # Groq
npm install @anthropic-ai/sdk  # Anthropic
# Ollama: no extra SDK, uses fetch
```

## Usage

```typescript
import { z } from "zod";
import { generate, openai, ollama, anthropic, groq } from "@aviasole/shapecraft";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});
const PersonSchema =  {
  "name": 'string',
  "age": 'number',
  "email": 'string',
};

// OpenAI — native constrained (server-side)
const model = openai({ model: "gpt-4o-mini" });

const result = await generate(model, PersonSchema, "Extract person info: John Doe, 32, john@example.com");

console.log(result.data);          // { name: "John Doe", age: 32, email: "john@example.com" }
console.log(result.guaranteeLevel); // "native"
console.log(result.attempts);       // 1
```

## Backends & Guarantee Levels

| Backend | Guarantee | Notes |
|---|---|---|
| `ollama()` | `constrained` | Token-level via GBNF grammar |
| `openai()` | `native` | Server-side strict JSON schema |
| `groq()` | `native` | JSON mode |
| `anthropic()` | `best-effort` | Prompt + parse + retry |

```typescript
// Ollama — true token-level constraint (local model)
const local = ollama({ model: "llama3.2" });

// Anthropic — best-effort with auto-retry
const claude = anthropic({ model: "claude-sonnet-4-6", maxRetries: 3 });

// Groq — fast native JSON mode
const fast = groq({ model: "llama-3.3-70b-versatile" });
```

## Error Handling

```typescript
import { SchemaViolationError, MaxRetriesExceededError } from "@aviasole/shapecraft";

try {
  const result = await generate(model, schema, prompt, { maxRetries: 3 });
} catch (err) {
  if (err instanceof MaxRetriesExceededError) {
    console.error(`Failed after ${err.attempts} attempts`);
  }
  if (err instanceof SchemaViolationError) {
    console.error("Raw output:", err.raw);
  }
}
```

## License

Apache-2.0 © Aviasole Technologies
