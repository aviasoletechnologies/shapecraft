# @aviasole/shapecraft

Structured output generation for LLMs in Node.js. Token-level constraints for local models, native JSON modes for cloud APIs — one unified API.

[![npm](https://img.shields.io/npm/v/@aviasole/shapecraft)](https://www.npmjs.com/package/@aviasole/shapecraft)
[![CI](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install @aviasole/shapecraft zod
```

Install backend SDK as needed:

```bash
npm install openai              # OpenAI
npm install groq-sdk            # Groq
npm install @anthropic-ai/sdk   # Anthropic
# Ollama: no extra SDK needed
```

## Quick Start

```typescript
import { z } from "zod";
import { generate, openai } from "@aviasole/shapecraft";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const model = openai({ model: "gpt-4o-mini" });

const result = await generate(model, PersonSchema, "Extract: John Doe, 32, john@example.com");

console.log(result.data);           // { name: "John Doe", age: 32, email: "john@example.com" }
console.log(result.guaranteeLevel); // "native"
console.log(result.attempts);       // 1
```

## Schema Inputs

Shapecraft accepts five schema types — not just Zod.

### Zod Schema

```typescript
import { z } from "zod";

const schema = z.object({ name: z.string(), score: z.number() });
const result = await generate(model, schema, prompt);
```

### Raw JSON Schema

```typescript
const result = await generate(model, {
  jsonSchema: {
    type: "object",
    properties: { name: { type: "string" }, score: { type: "number" } },
    required: ["name", "score"],
  },
}, prompt);
```

### Regex Pattern

```typescript
// Model must return a string matching the pattern
const result = await generate(model, {
  pattern: /^\d{4}-\d{2}-\d{2}$/,
}, "What is today's date?");

console.log(result.data); // "2025-01-15"
```

### Custom Validator

```typescript
const result = await generate(model, {
  validate: (output) => typeof output === "object" && output !== null && "id" in output,
  hint: { type: "object", properties: { id: { type: "string" } } },
}, prompt);
```

### XML

You provide an example XML template with `{string}` / `{number}` / `{boolean}`
placeholders — the model fills it in. By default `result.data` is the **validated
XML string** (the format you asked for); add `parse: true` to get a parsed JS
object instead. Either way the output is validated as well-formed XML, and any
`required` nodes must be present and non-empty or the call retries.

```typescript
const result = await generate(model, {
  xml: {
    template: `<book>\n  <title>{string}</title>\n  <author>{string}</author>\n  <year>{number}</year>\n</book>`,
    required: ["title", "author"],
  },
}, 'Extract: "Clean Code" by Robert C. Martin, 2008.');

console.log(result.data);
// "<book>\n  <title>Clean Code</title>\n  <author>Robert C. Martin</author>\n  <year>2008</year>\n</book>"
```

Anything you write in the template is reproduced verbatim — including
**attributes** and **namespaces**, which fall out for free:

```typescript
const result = await generate(model, {
  xml: {
    template: `<book id="{string}" available="{boolean}">\n  <title lang="{string}">{string}</title>\n</book>`,
    required: ["title"],
  },
}, "Effective TypeScript, ISBN 978-1-4920-5374-3, in stock, English.");

// result.data → '<book id="978-1-4920-5374-3" available="true">\n  <title lang="en">Effective TypeScript</title>\n</book>'
```

The `xml` options:

| Option | Purpose |
|---|---|
| `template` | example XML with `{string}` / `{number}` / `{boolean}` placeholders |
| `required` | node names that must be present **and non-empty**, else retry (matched at any depth) |
| `arrays` | node names to always coerce into arrays when `parse: true` |
| `parse` | return the parsed object instead of the XML string |

```typescript
// parse: true → object
const result = await generate(model, {
  xml: {
    template: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>`,
    parse: true,
  },
}, "Extract: John Doe, 35 years old.");

console.log(result.data); // { name: "John Doe", age: 35 }
```

> XML is prompt-driven on all backends (no token-level constraint), so a capable
> model gives the most reliable output on deeply nested templates. Use `required`
> to guarantee the important nodes are actually filled in.

## Backends & Guarantee Levels

| Backend | Guarantee | Mechanism |
|---|---|---|
| `openai()` | `native` | Server-side strict JSON schema |
| `groq()` | `native` | JSON mode |
| `ollama()` | `constrained` | Token-level GBNF grammar |
| `anthropic()` | `best-effort` | Prompt + parse + retry |

```typescript
import { openai, groq, ollama, anthropic } from "@aviasole/shapecraft";

const gpt    = openai({ model: "gpt-4o-mini" });
const fast   = groq({ model: "llama-3.3-70b-versatile" });
const local  = ollama({ model: "llama3.2" });
const claude = anthropic({ model: "claude-haiku-4-5-20251001", maxRetries: 3 });
```

## Options

```typescript
const result = await generate(model, schema, prompt, {
  maxRetries: 3,        // default: 2
  temperature: 0.2,
  systemPrompt: "You are a data extraction assistant.",
});
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
    console.error("Errors:", err.validationErrors);
  }
}
```

## License

Apache-2.0 © Aviasole Technologies
