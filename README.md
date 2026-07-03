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

You provide an example XML template — the model fills it in. By default
`result.data` is the **validated XML string** (the format you asked for); add
`parse: true` to get a parsed JS object instead.

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

#### Template rules

**1. Only `{string}`, `{number}`, `{boolean}` are valid inside `{}`.**
Anything else wrapped in braces throws before the model is ever called — a
typo'd placeholder is a template bug, not something worth retrying.

```typescript
import { xmlType } from "@aviasole/shapecraft";

xml: { template: `<book edition="${xmlType.string}">...` }   // ✅ fine
xml: { template: `<book edition="{strng}">...` }             // ❌ throws immediately:
// "Invalid placeholder(s) in xml.template: {strng}. Only {string}, {number},
//  and {boolean} are recognized (see xmlType)."
```

**2. Text with no `{}` at all is a literal — reproduced as-is, best-effort.**
The model is instructed to leave it untouched, and usually does. But text that
*reads* like an instruction (a description, a placeholder-shaped phrase) can
still get "helpfully" rewritten by the model — that's an LLM judgment call, not
something a validator can catch, since there's no syntax marking it special.

```typescript
xml: { template: `<book status="in-stock">...` }
// "in-stock" is fixed content — usually passed through unchanged
```

If a value must be **guaranteed** unchanged, use `enforceLiterals` (below) — or
better, leave it out of the template entirely and splice it into
`result.data` yourself after `generate()` returns.

**3. Attributes follow the same two rules as element text.**
`{string}`/`{number}`/`{boolean}` in an attribute gets filled in; anything else
is a literal.

```typescript
xml: {
  template: `<book id="{string}" available="{boolean}">\n  <title lang="{string}">{string}</title>\n</book>`,
}
// result.data → '<book id="978-1-4920-5374-3" available="true">\n  <title lang="en">Effective TypeScript</title>\n</book>'
```

**4. Namespaces and prefixes are literal text — write them however you need.**

```typescript
xml: {
  template: `<xs:catalog xmlns:xs="http://example.com"><xs:book>{string}</xs:book></xs:catalog>`,
  required: ["xs:book"],
}
```

**5. For repeated elements, show one example — the model repeats the tag.**
Use `arrays` to force single-item results into an array under `parse: true`.

```typescript
xml: {
  template: `<library><book><title>{string}</title></book></library>`,
  arrays: ["book"], // parse:true → library.book is always an array, even with 1 result
}
// model output: <library><book>...</book><book>...</book></library>
```

**6. `required` names must be present *and non-empty*, or the call retries — matched at any depth.**

```typescript
xml: { template: `<order><id>{string}</id><items>{string}</items></order>`, required: ["id", "items"] }
// <order><id>ORD-1</id><items></items></order>  → retries (items is empty)
```

**7. `enforceLiterals: true` guarantees literal fidelity, deterministically.**
Every non-`{}` value in the template is force-corrected in the output — even
if the model changed it, or dropped the whole node. This closes the gap from
rule 2, at the cost of re-serializing the output (formatting may differ
slightly from the model's raw text, though it's always valid XML).

```typescript
const result = await generate(model, {
  xml: {
    template: `<catalog updated="2026-01-01" totalBooks="90"><title>{string}</title></catalog>`,
    enforceLiterals: true,
  },
}, "The Road by Cormac McCarthy.");

// "updated" and "totalBooks" are guaranteed to stay exactly "2026-01-01" / "90",
// regardless of anything in the prompt that might tempt the model to "correct" them
```

**8. The `<?xml ...?>` prolog is stripped by default — set `prolog: true` to keep it.**
Models sometimes prepend a declaration on their own; most templates are meant
to be fragments, not full documents, so it's stripped unless you ask for it.

```typescript
xml: { template: `<book>{string}</book>`, prolog: true }
// result.data → '<?xml version="1.0" encoding="UTF-8"?>\n<book>...</book>'
```

**9. `parse: true` returns the parsed object instead of the XML string.**

```typescript
const result = await generate(model, {
  xml: { template: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>`, parse: true },
}, "Extract: John Doe, 35 years old.");

console.log(result.data); // { name: "John Doe", age: 35 }
```

#### `xml` options reference

| Option | Purpose |
|---|---|
| `template` | example XML with `{string}` / `{number}` / `{boolean}` placeholders |
| `required` | node names that must be present **and non-empty**, else retry (matched at any depth) |
| `arrays` | node names to always coerce into arrays when `parse: true` |
| `parse` | return the parsed object instead of the XML string |
| `prolog` | keep a `<?xml ...?>` declaration in the output (default: stripped) |
| `enforceLiterals` | force every non-placeholder value to match the template exactly, deterministically |

> XML is prompt-driven on all backends (no token-level constraint), so a capable
> model gives the most reliable output on deeply nested templates.

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

## What shapecraft guarantees — and what it doesn't

Every mechanism above (`native`, `constrained`, `best-effort` + retry) targets one thing: **the output is structurally valid** — it parses, the types match, required fields are present and non-empty. That's a real, load-bearing guarantee: it's the difference between code that can trust `result.data.age` is a `number` versus code that has to defensively re-check everything the model says.

What it doesn't cover is **whether a value is actually true.** A schema (or GBNF grammar) constrains *shape*, not *content* — a model can be perfectly schema-compliant while filling a field from its own priors instead of your source text. For example: a required `date` field that always parses, always matches the type, and is occasionally fabricated because the source text simply didn't contain a date. Nothing in `required`, type-checking, or `enforceLiterals` catches that — none of it throws, because nothing about the output is structurally wrong.

So think of it as two layers:

- **Structural correctness** (shapecraft's job): valid JSON/XML, correct types, required fields present. Solved.
- **Semantic correctness** ("is this value actually grounded in the input?"): a separate concern shapecraft doesn't attempt today. If your use case needs that guarantee — financial data, dates, anything where a plausible-but-wrong value is costly — pair shapecraft with your own grounding check (e.g. verifying extracted values trace back to the source text) or a second-pass verifier, rather than trusting `required` alone.

This isn't a reason to avoid structural validation — it eliminates an entire class of bugs (parse errors, wrong types, missing fields) that would otherwise hit you in production. It just isn't the same guarantee as "this value is correct," and knowing the boundary is what lets you build the right check on top for the cases that need one.

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
