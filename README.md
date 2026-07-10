# @aviasole/shapecraft

Structured output generation for LLMs in Node.js. Token-level constraints for local models, native JSON modes for cloud APIs — one unified API.

[![npm](https://img.shields.io/npm/v/@aviasole/shapecraft)](https://www.npmjs.com/package/@aviasole/shapecraft)
[![CI](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

![shapecraft demo](assets/demo.gif)

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

### Model Capabilities

Every built-in backend also exposes `capabilities` — an explicit, inspectable alternative to duck-typing `typeof model.generateStream === "function"` for routing logic:

```typescript
console.log(claude.capabilities);
// { streaming: true, chat: true, structuredOutput: true, toolCalling: false }
```

```typescript
interface ModelCapabilities {
  streaming: boolean;       // has generateStream()
  chat: boolean;            // has chat() - required for turnaround: true
  structuredOutput: boolean; // has generate() - always true
  toolCalling: boolean;     // not yet supported by any backend
}
```

`capabilities` is optional on `ShapecraftModel` — a custom model implementation that predates this field (or simply doesn't set it) still satisfies the interface unchanged, and `model.capabilities` is `undefined` for it. `chat?`/`generateStream?` remain the actual methods the core calls; `capabilities` is just a declared summary of the same information, not a replacement mechanism.

## Streaming

`generateStream()` streams tokens live for UX, but validates the assembled response exactly once, through the same pipeline as `generate()` — streaming is purely a transport layer, not a different guarantee. Falls back to one-shot `generate()` for a model without streaming support.

```typescript
import { generateStream, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

const stream = generateStream(model, PersonSchema, "Extract: Jane Doe, 28, jane@example.com");

for await (const delta of stream.textStream) {
  process.stdout.write(delta); // raw text as it arrives
}

const { data, attempts, guaranteeLevel } = await stream.result; // validated once, at the end
```

For lifecycle control (retries, incremental field validation), use `stream.events` instead:

```typescript
for await (const event of stream2.events) {
  switch (event.type) {
    case "attempt-start":   /* a new attempt began */ break;
    case "delta":           process.stdout.write(event.text); break;
    case "partial":         console.log("validated so far:", event.value); break;
    case "attempt-failed":  console.log(`attempt ${event.attempt} failed, retrying`); break;
    case "done":            console.log(event.result.data); break;
  }
}
```

**`partial` events — incremental per-field validation.** For JSON/Zod object schemas, each top-level field is validated the instant its own value closes in the stream — before the whole object is done — against its own sub-schema (`z.object` shape, or `jsonSchema.properties`). If a field fails, the attempt aborts immediately (no more tokens pulled) and retries fresh, instead of waiting to discover the failure only after the full response arrives. XML, pattern, and custom-validator schemas don't decompose this way — they only emit `delta`/`done`.

**Retries are visible, not silent.** Non-streaming `generate()` retries invisibly — a failed attempt is simply discarded and re-asked. With streaming, tokens have already been shown before validation can run, so a failed attempt can't be un-sent: it emits `attempt-failed` and starts a fresh `attempt-start`. A UI rendering partial text should clear its buffer on `attempt-failed`/`attempt-start`. There's no "only show validated tokens" mode — that would mean waiting for the whole response, which isn't streaming; use non-streaming `generate()` if you need that.

**Streaming smoothness tracks guarantee level.** `native`/`constrained` backends (OpenAI, Groq, Ollama) rarely fail validation — the server already constrains tokens as they're generated — so streams almost never restart. `best-effort` (Anthropic) has no such constraint, so a stream may visibly restart more often.

## createClient() & Middleware

For cross-cutting concerns (logging, caching, telemetry) that would otherwise mean editing `generate()` itself, wrap it once with `createClient()` — a Koa-style onion middleware chain plus client-level defaults.

```typescript
import { createClient, loggingMiddleware } from "@aviasole/shapecraft";

const client = createClient({
  middleware: [loggingMiddleware()],
  retry: { max: 3 },
  timeoutMs: 10_000,
});

const result = await client.generate(model, schema, prompt);
```

A middleware sees the request before `next()` runs and the result/error after — outer middlewares wrap inner ones, like nested boxes, not a flat sequence:

```typescript
import type { Middleware } from "@aviasole/shapecraft";

const timing: Middleware = async (ctx, next) => {
  const t0 = Date.now();
  const result = await next();          // everything below this middleware runs first
  console.log(`${ctx.model.id} took ${Date.now() - t0}ms`);
  return result;
};
```

A middleware that never calls `next()` short-circuits the real call entirely — the standard shape for a cache:

```typescript
import type { Middleware, GenerateResult } from "@aviasole/shapecraft";

const cache = new Map<string, GenerateResult<unknown>>();

const cachingMiddleware: Middleware = async (ctx, next) => {
  const key = `${ctx.model.id}:${ctx.prompt}`;
  const hit = cache.get(key);
  if (hit) return hit;                  // model never called
  const result = await next();
  cache.set(key, result);
  return result;
};
```

`createClient()` is purely additive — existing direct calls to `generate()`/`generateStream()` are unaffected. Middleware wraps `generate()` only; `generateStream()` picks up the client's `retry`/`timeoutMs`/`jsonSchemaValidator` defaults but isn't intercepted by middleware (its async-iterable shape doesn't fit the simple before/after `next()` model).

## Batch Generation

Run multiple independent prompts (each with its own model/schema/options) in parallel, capped at `concurrency` in flight at once:

```typescript
import { generateBatch } from "@aviasole/shapecraft";

const results = await generateBatch(
  [
    { model, schema, prompt: "Extract: Jane Doe, 28" },
    { model, schema, prompt: "Extract: John Smith, 41" },
    { model, schema, prompt: "Extract: Ada Lovelace, 36" },
  ],
  { concurrency: 2 } // omit to run every item concurrently, uncapped
);

for (const r of results) {
  if (r.status === "fulfilled") console.log(r.value.data);
  else console.error("failed:", r.reason);
}
```

Each item settles independently - `Promise.allSettled`-style, never `Promise.all`-style - so one bad prompt doesn't lose the results of the rest of the batch. Order is preserved: `results[i]` always corresponds to the item at `items[i]`, regardless of which finishes first.

Available through `createClient()` too, so each item gets the client's middleware/retry/timeout/validator defaults, same as calling `client.generate()` on it individually:

```typescript
const client = createClient({ retry: { max: 3 } });
const results = await client.generateBatch(items, { concurrency: 5 });
```

## Result Metadata

Every `GenerateResult` includes `metadata`:

```typescript
const result = await generate(model, schema, prompt);

console.log(result.metadata);
// { provider: "groq", model: "llama-3.3-70b-versatile", latencyMs: 284 }
```

```typescript
interface ResultMetadata {
  provider: string;
  model: string;
  latencyMs: number;
  tokens?: { input: number; output: number };
  finishReason?: string;
  requestId?: string;
  cost?: number;
}
```

`provider`, `model`, and `latencyMs` are always populated by the core (parsed from `model.id`, measured around the call). `tokens`, `finishReason`, `requestId`, and `cost` are reserved for a future backend hook that surfaces the underlying API response's usage data — they're `undefined` today, on every backend.

## Timeouts & Cancellation

Bound or cancel a single attempt with `timeoutMs` and/or an `AbortSignal`:

```typescript
import { TimeoutError } from "@aviasole/shapecraft";

try {
  const result = await generate(model, schema, prompt, { timeoutMs: 5_000 });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error(`Timed out after ${err.timeoutMs}ms`);
  }
}
```

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const result = await generate(model, schema, prompt, { signal: controller.signal });
```

Enforced at the core level for every backend — the retry loop always stops waiting once the timeout/signal fires, even against a backend that ignores cancellation entirely. All four built-in backends (`openai`, `groq`, `anthropic`, `ollama`) additionally forward the signal to the underlying SDK/fetch call for real request cancellation, not just abandonment. `TimeoutError` is never retried (it isn't a `SchemaViolationError`).

## Pluggable JSON Schema Validation

The built-in `jsonSchema` check (`checkJsonSchema`) is intentionally shallow — it validates types and `required` presence, not `minLength`/`maximum`/`pattern`/`$ref`/etc. Rather than expanding it, it's pluggable: supply your own validator (or wire up AJV) via `jsonSchemaValidator`.

```typescript
const strictValidator = (value: unknown, schema: Record<string, unknown>) => {
  // throw to reject; return normally to accept
  const v = value as { age?: number };
  if (typeof v.age !== "number" || v.age < 0 || v.age > 130) {
    throw new Error("age must be a plausible human age");
  }
};

const result = await generate(model, { jsonSchema: PersonJsonSchema }, prompt, {
  jsonSchemaValidator: strictValidator,
});
```

Applies to both `generate()`'s final check and `generateStream()`'s per-field incremental (`partial`) validation, so a custom validator behaves consistently whether or not you're streaming. Omit it and you get today's `checkJsonSchema` behavior, unchanged.

## Staged Validation Pipeline

`generate()`'s validation step is a pipeline: `parse → structural validation → semantic validation → confidence scoring → post-processors → return`. Structural validation is unchanged and the only required stage — the rest are opt-in.

```typescript
const result = await generate(model, PersonSchema, prompt, {
  // runs after structural validation passes — throw to fail (retries, same as a schema violation)
  semanticValidator: (value, { prompt }) => {
    if (!prompt.includes(value.name)) throw new Error(`"${value.name}" not grounded in source text`);
  },
  // returns a 0-1 score, exposed as result.confidence
  confidenceScorer: (value) => (value.name.length > 1 ? 0.9 : 0.3),
  minConfidence: 0.5, // a score below this also fails the attempt and retries
  // runs last, in array order, on a value that already passed every check above
  postProcessors: [(value) => ({ ...value, name: value.name.trim() })],
});

console.log(result.confidence); // 0.9
```

All three are also settable as `createClient()` defaults, following the same per-call-overrides-client-default pattern as `jsonSchemaValidator`. Only `generate()` runs the full pipeline today — `generateStream()`'s per-field incremental checks still use `checkJsonSchema`/your `jsonSchemaValidator` only.

## What shapecraft guarantees — and what it doesn't

Every mechanism above (`native`, `constrained`, `best-effort` + retry) targets one thing: **the output is structurally valid** — it parses, the types match, required fields are present and non-empty. That's a real, load-bearing guarantee: it's the difference between code that can trust `result.data.age` is a `number` versus code that has to defensively re-check everything the model says.

What it doesn't cover is **whether a value is actually true.** A schema (or GBNF grammar) constrains *shape*, not *content* — a model can be perfectly schema-compliant while filling a field from its own priors instead of your source text. For example: a required `date` field that always parses, always matches the type, and is occasionally fabricated because the source text simply didn't contain a date. Nothing in `required`, type-checking, or `enforceLiterals` catches that — none of it throws, because nothing about the output is structurally wrong.

So think of it as two layers:

- **Structural correctness** (shapecraft's job): valid JSON/XML, correct types, required fields present. Solved.
- **Semantic correctness** ("is this value actually grounded in the input?"): shapecraft doesn't check this for you by default — `required`/type-checking alone can't. What it does provide is the hook: `semanticValidator` in the [Staged Validation Pipeline](#staged-validation-pipeline) runs your own grounding check (e.g. verifying an extracted value traces back to the source text) after structural validation passes, and fails/retries the attempt exactly like a schema violation if it doesn't hold. If your use case needs that guarantee — financial data, dates, anything where a plausible-but-wrong value is costly — write that check and pass it in, rather than trusting `required` alone.

This isn't a reason to avoid structural validation — it eliminates an entire class of bugs (parse errors, wrong types, missing fields) that would otherwise hit you in production. It just isn't the same guarantee as "this value is correct," and knowing the boundary is what lets you build the right check on top for the cases that need one.

## Options

```typescript
const result = await generate(model, schema, prompt, {
  maxRetries: 3,        // default: 2
  temperature: 0.2,
  systemPrompt: "You are a data extraction assistant.",
});
```

| Option | Purpose |
|---|---|
| `maxRetries` | attempts before throwing `MaxRetriesExceededError` (default: 2) |
| `temperature` | forwarded to the backend, where supported |
| `systemPrompt` | prepended instruction, combined with the schema-derived prompt |
| `timeoutMs` | bound a single attempt's wall-clock time — see [Timeouts & Cancellation](#timeouts--cancellation) |
| `signal` | an `AbortSignal` to cancel an in-flight attempt — see [Timeouts & Cancellation](#timeouts--cancellation) |
| `jsonSchemaValidator` | override the built-in `jsonSchema` structural check — see [Pluggable JSON Schema Validation](#pluggable-json-schema-validation) |
| `semanticValidator` | content/grounding check after structural validation passes — see [Staged Validation Pipeline](#staged-validation-pipeline) |
| `confidenceScorer` | assigns a 0-1 score to `result.confidence` — see [Staged Validation Pipeline](#staged-validation-pipeline) |
| `minConfidence` | fails and retries the attempt if `confidenceScorer`'s score is below this |
| `postProcessors` | array of transforms applied in order to an already-validated value — see [Staged Validation Pipeline](#staged-validation-pipeline) |

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
