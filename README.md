<img src="assets/logo.png" alt="shapecraft" width="72" height="72" />

# @aviasole/shapecraft

Structured output generation for LLMs in Node.js. Token-level constraints for local models, native JSON modes for cloud APIs — one unified API.

[![npm](https://img.shields.io/npm/v/@aviasole/shapecraft)](https://www.npmjs.com/package/@aviasole/shapecraft)
[![CI](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/aviasoletechnologies/shapecraft/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

![shapecraft demo](assets/demo.gif)

## Install

```bash
npm install @aviasole/shapecraft zod
# or: pnpm add @aviasole/shapecraft zod
```

`zod` is an optional peer dependency, used for the Zod schema examples throughout this README - install it too if you're using Zod schemas (the common path): `npm install zod`.

Install backend SDK as needed:

```bash
npm install openai              # OpenAI, Fireworks, Mistral, OpenRouter, DeepSeek, Together, Cerebras, Grok, openaiCompatible
npm install groq-sdk            # Groq
npm install @anthropic-ai/sdk   # Anthropic
npm install @google/genai       # Gemini
npm install node-llama-cpp      # Local .gguf models
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

## Documentation


Full guide and reference docs — schema inputs, backends & guarantee levels, streaming, `createClient()` & middleware, batch generation, result metadata, timeouts, pluggable validation, the staged validation pipeline, FHIR presets, turnaround, skill-based generation, multi-agent orchestration, tool calling, the CLI, and error handling: **[aviasoletechnologies.github.io/shapecraft](https://aviasoletechnologies.github.io/shapecraft/)**
## Schema Inputs

Shapecraft accepts eight schema types — not just Zod.

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

### GBNF grammar

Pass a raw [GBNF](https://github.com/ggerganov/llama.cpp/blob/master/grammars/README.md)
(GGML BNF) grammar string. `result.data` is the **raw string** that conforms to the
grammar — GBNF describes a string language, not a JSON shape, so it's never parsed.

```typescript
const result = await generate(model, {
  gbnf: `
    root  ::= year "-" month "-" day
    year  ::= [0-9]{4}
    month ::= [0-9]{2}
    day   ::= [0-9]{2}
  `,
}, "When did WWII end in Europe?");

console.log(result.data); // "1945-05-08"
```

**The guarantee is backend-dependent — this is the one input where that's true.** On
`llamaCpp()` the grammar is enforced at the **token level**: the model literally cannot
emit a token that breaks the grammar, so the output is valid *by construction*
(`constrained`). On every other backend (`openai`, `groq`, `anthropic`, `ollama`) there
is no grammar parameter, so the grammar is injected into the prompt (best-effort) and the
returned string is validated against the grammar by a **bundled GBNF interpreter**, then
retried on a mismatch.

```typescript
import { llamaCpp } from "@aviasole/shapecraft";

const local = llamaCpp({ modelPath: "./models/llama-3.2-3b.gguf" }); // npm install node-llama-cpp
const { data } = await generate(local, {
  gbnf: `root ::= "positive" | "negative" | "neutral"`,
}, "Sentiment of: 'I love this!'");
// data: "positive" — constrained, cannot be anything else
```

#### What the interpreter enforces (and what it doesn't)

The bundled interpreter is a deliberate **subset**, in the same spirit as `checkJsonSchema`
(a useful subset of JSON Schema, not the whole spec). A malformed grammar, or one using an
unsupported construct, throws **before the model is ever called** — a grammar bug, not
something to retry.

| GBNF construct | Supported |
|---|---|
| String literals, rule references, sequences | ✅ |
| Alternation `\|`, grouping `( )` | ✅ |
| Repetition `*` `+` `?` `{m}` `{m,}` `{m,n}` | ✅ |
| Character classes `[a-z]` `[^0-9]`, ranges, escapes (`\n \t \" \xNN \uNNNN`) | ✅ |
| `#` line comments | ✅ |
| **Left-recursive rules** | ⚠️ not fully supported — validation may reject; never hangs |
| **Deeply right-recursive rule *references*** (`list ::= item "," list \| item`) | ⚠️ has a real depth limit (see below) |
| Nested/imported grammars, llama.cpp extensions | ❌ throws at parse time |

The subset applies on **all** backends, including `llamaCpp()` (the JS validation still runs
for pipeline uniformity). As always, the grammar constrains **shape, not truth** — a
conforming string can still be a wrong answer (see
[guarantees](#what-shapecraft-guarantees--and-what-it-doesnt)).

**Stress-tested failure modes (what actually breaks, found by deliberately trying to break it):**

- **Catastrophic/exponential backtracking — not reproducible.** The classic patterns that
  blow up naive backtracking regex engines (e.g. `("a" "a"?)* "b"` against a long run of `a`
  with no trailing `b`) resolve in milliseconds here, because the matcher dedupes by
  *position reached*, not by path taken — it's closer to a bounded reachability search than
  a naive backtracker.
- **A genuinely adversarial grammar can still exceed the step budget** — a ~26-way
  variable-length ambiguous alternation over a 300k-character input with an unmatchable
  terminator trips it in well under a second, throwing a clear "step budget" error rather
  than hanging. This is a real, if hard-to-reach, backstop — not just an untested code path.
- **Deep right-recursion via a rule *reference* has a hard limit — this is a real gap, not
  just theoretical.** `*` and `+` are matched iteratively (no recursion, no limit tested up to
  50k+ repetitions). But a rule written as `list ::= item "," list | item` recurses through
  the JS call stack once per repetition, and breaks — empirically, somewhere in the
  900–1000 repetition range on a typical build. Past that point `matchesGbnf` throws a clear,
  actionable error (*"GBNF grammar recursion is too deep... prefer `*`/`+`"*) instead of a raw
  native stack-overflow trace. **If your grammar needs a long repeated sequence, write it
  with `*`/`+`, not recursive rule references** — this is the one place "conventionally
  right-recursive GBNF" needs a caveat.

### YAML

You describe the target shape as a JSON Schema, and the model responds in YAML instead
of JSON. By default `result.data` is the **parsed object**; add `parse: false` to get the
raw YAML string back instead.

```typescript
const result = await generate(model, {
  yaml: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    },
  },
}, "Extract: John Doe, 32 years old.");

console.log(result.data); // { name: "John Doe", age: 32 }
```

Output is parsed with [`yaml`](https://www.npmjs.com/package/yaml) then validated against
the schema with the same `checkJsonSchema` logic a `{ jsonSchema }` input uses — a required
field that's missing or the wrong type retries, same as everywhere else. A model that wraps
its response in a ` ```yaml ` markdown fence has the fence stripped automatically before
parsing. `guaranteeLevel` is always `best-effort` — no backend enforces YAML output
server-side.

### OpenAPI spec

Point at an `operationId` in an existing OpenAPI 3.x spec instead of hand-writing a JSON
Schema. `spec` can be a file path, a URL, or an already-parsed object.

```typescript
const result = await generate(model, {
  openapi: {
    spec: "./openapi.yaml",
    operationId: "createUser",
    // target: "requestBody" is the default - pass target: "response" to
    // derive from the success response schema instead
  },
}, "A user named Jane Doe, age 29, admin role");
```

The spec is dereferenced and the operation's schema is derived **once, upfront** - from
that point on it's handled exactly like a `{ jsonSchema }` input, same validation, same
retry behavior. An `operationId` that doesn't exist in the spec, or an operation with no
schema on the requested `target`, throws immediately - before the model is ever called,
same philosophy as a malformed GBNF grammar or an invalid XML template.

> v1 resolves only the default success response (`200`/`201`/`default`) for
> `target: "response"` and only OpenAPI 3.x specs (not Swagger 2.0) - both are real,
> deliberate scope cuts, not oversights.

## Backends & Guarantee Levels

| Backend | Guarantee | Mechanism |
|---|---|---|
| `openai()` | `native` | Server-side strict JSON schema |
| `groq()` | `native` | JSON mode |
| `deepseek()` | `native` | JSON mode (no schema-strict mode, same tier as `groq()`) |
| `fireworks()` | `native` | Server-side JSON schema mode, plus a real token-level GBNF grammar mode |
| `mistral()` | `native` | Server-side JSON schema mode |
| `gemini()` | `native` | Server-side JSON schema mode (`responseJsonSchema`) |
| `ollama()` | `constrained` | Token-level JSON-schema constraint |
| `llamaCpp()` | `constrained` | Token-level GBNF grammar (local `.gguf` via node-llama-cpp) |
| `anthropic()` | `best-effort` | Prompt + parse + retry |
| `openRouter()` | `best-effort` | Pass-through to many providers - `response_format` support varies by underlying model |
| `together()` | `native` | Server-side JSON schema mode |
| `cerebras()` | `native` | Server-side strict JSON schema mode |
| `grok()` | `native` | Server-side JSON schema mode |
| `openaiCompatible()` | `best-effort` (override to `native` if your provider enforces it) | Generic factory - see below |

> `llamaCpp()` is `constrained` for a `{ gbnf }` input (token-level). For other schema
> types (Zod / jsonSchema / …) it currently runs a best-effort prompt path until the
> JSON-Schema→GBNF converter lands — treat those as best-effort despite the nominal level.
>
> `fireworks()` is the one cloud backend where a `{ gbnf }` input is *not* downgraded to
> best-effort — Fireworks' grammar mode (`response_format: { type: "grammar", grammar }`)
> applies the GBNF grammar as a genuine token-level constraint server-side, the same
> guarantee `llamaCpp()` gives locally. It reuses the `openai` package pointed at
> Fireworks' base URL, so no extra SDK dependency is needed.
>
> `openRouter()` is deliberately `best-effort`, not `native` like the other cloud
> backends — it's pass-through across many different underlying providers/models, and
> `response_format: { type: "json_schema" }` enforcement isn't guaranteed for every model
> it can route to, only the ones that actually support it themselves.
>
> `gemini()` uses the official `@google/genai` SDK, not an OpenAI-compatible endpoint
> (unlike `fireworks()`/`mistral()`/`openRouter()`) — Gemini's OpenAI-compat layer is a
> migration bridge for OpenAI users, not its primary integration path, and doesn't expose
> `responseJsonSchema` (plain JSON Schema, what `toJsonSchema()` already produces) —
> only the older `responseSchema` (Gemini's own Type-enum OpenAPI-subset shape).
>
> `together()`/`cerebras()`/`grok()` all reuse the `openai` package pointed at their
> respective base URLs, same pattern as `fireworks()`/`mistral()`/`openRouter()` - no new
> SDK dependency. None expose a genuine grammar/constrained-decoding mode, so a `{ gbnf }`
> input on any of the three is prompt-only best-effort, same as `openai()`/`groq()`.

### `openaiCompatible()`

For any OpenAI-compatible provider shapecraft doesn't name explicitly - `baseURL`,
`apiKey`, and `model` are all caller-supplied instead of hardcoded per provider:

```typescript
import { openaiCompatible } from "@aviasole/shapecraft";

const custom = openaiCompatible({
  baseURL: "https://api.some-provider.example/v1",
  apiKey: process.env.SOME_PROVIDER_API_KEY,
  model: "some-model-id",
  guaranteeLevel: "native", // optional - omit to default to "best-effort"
});
```

Defaults to `guaranteeLevel: "best-effort"` since shapecraft can't verify an arbitrary
endpoint actually enforces `json_schema` server-side. Pass `guaranteeLevel: "native"`
explicitly if you know your provider does, for accurate reporting. Unlike the named
backends, there's no environment-variable fallback for the API key - there's no single
conventional env-var name for an arbitrary provider, so `apiKey` is required.

```typescript
import { openai, groq, fireworks, mistral, gemini, openRouter, deepseek, ollama, anthropic, llamaCpp, together, cerebras, grok, openaiCompatible } from "@aviasole/shapecraft";

const gpt       = openai({ model: "gpt-4o-mini" });
const fast      = groq({ model: "llama-3.3-70b-versatile" });
const cloudGbnf = fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" });
const mist      = mistral({ model: "mistral-large-latest" });
const gem       = gemini({ model: "gemini-flash-latest" });
const router    = openRouter({ model: "openai/gpt-4o-mini" });
const deep      = deepseek({ model: "deepseek-v4-flash" });
const local     = ollama({ model: "llama3.2" });
const native    = llamaCpp({ modelPath: "./models/llama-3.2-3b.gguf" });
const claude    = anthropic({ model: "claude-haiku-4-5-20251001", maxRetries: 3 });
```

Every built-in backend also exposes `capabilities` (`streaming`/`chat`/`structuredOutput`/`toolCalling`/`skillDispatch`) - an explicit, inspectable alternative to duck-typing `typeof model.generateStream === "function"` for routing logic. See the [Backends & Guarantee Levels guide](https://aviasoletechnologies.github.io/shapecraft/guide/backends) for the full mechanism breakdown and the `ModelCapabilities` interface, and [what shapecraft guarantees and what it doesn't](https://aviasoletechnologies.github.io/shapecraft/reference/guarantees) for the structural-vs-semantic-correctness distinction.

## How shapecraft compares

Other libraries solve overlapping parts of this problem well. This is what's actually different, not a scorecard:

| Capability | Instructor-js | zod-gpt | Vercel AI SDK (`generateObject`) | shapecraft |
|---|---|---|---|---|
| Providers | OpenAI only | OpenAI, Anthropic | OpenAI, Anthropic, Google, and more | OpenAI, Groq, Fireworks, Mistral, OpenRouter, DeepSeek, Together, Cerebras, xAI, Gemini, Anthropic, Ollama, llama.cpp, any OpenAI-compatible endpoint |
| Local model support | - | - | no grammar-level constraint | Ollama / llama.cpp with token-level GBNF grammar |
| Per-provider reliability signal | - | - | - | `guaranteeLevel`: `native` / `constrained` / `best-effort` |
| Retry on schema failure | not documented | fixed 3 attempts, 60s timeout | configurable `maxRetries` | configurable, only on schema-validation failure |
| Timeout / cancellation | not documented | hardcoded 60s | via provider fetch options | `timeoutMs` / `AbortSignal`, enforced at the core regardless of backend |
| Streaming | yes | - | yes (`streamObject`) | yes, with per-field incremental validation |
| Schema input types | Zod only | Zod only | Zod, Valibot, JSON schema | Zod, JSON schema, regex, custom validator, XML, GBNF |

The gap that actually matters: none of the others tell you *how much* to trust a given provider's structured output, or give local models the same real enforcement cloud providers get. shapecraft's `guaranteeLevel` makes that explicit instead of leaving it as something you find out in production.

## What's included

- **Schema inputs**: Zod, raw JSON Schema, regex pattern, custom validator, XML (with template placeholders and `enforceLiterals`), raw GBNF grammar
- **Streaming**: `generateStream()` with per-field incremental validation, visible retries on validation failure
- **`createClient()` & middleware**: a Koa-style onion pipeline for logging, caching, and other cross-cutting concerns
- **Batch generation**: `generateBatch()`, concurrency-capped, `Promise.allSettled`-style
- **Result metadata**: `provider`, `model`, `latencyMs` on every result
- **Timeouts & cancellation**: `timeoutMs` / `AbortSignal`, enforced at the core for every backend
- **Pluggable JSON Schema validation**: swap in your own validator (or AJV) via `jsonSchemaValidator`
- **Staged validation pipeline**: `semanticValidator`, `confidenceScorer`, `postProcessors` on top of structural validation
- **FHIR R4 presets**: `Patient`, `Observation`, `Condition`, `MedicationRequest`, `Encounter`, via `@aviasole/shapecraft/fhir`, including a common `extension?: Extension[]` field
- **Turnaround**: multi-turn collection via `generate(..., { turnaround: true })`, validated once over the whole transcript
- **Skill-based generation**: `SkillRegistry` + `generateSkillCall()`/`runSkillLoop()` for model-driven dispatch to typed operations
- **Multi-agent orchestration**: `defineAgent()` + `runAgents()` for chaining validated `generate()` calls, via `@aviasole/shapecraft/agentic`
- **Tool calling**: `generateWithTools()` for native provider function-calling with validated arguments and a validated final answer
- **CLI**: `npx shapecraft validate --schema schema.json --output output.json`

Full docs for all of the above: **[aviasoletechnologies.github.io/shapecraft](https://aviasoletechnologies.github.io/shapecraft/)**

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

See the [Error Handling guide](https://aviasoletechnologies.github.io/shapecraft/guide/error-handling) and [Options reference](https://aviasoletechnologies.github.io/shapecraft/reference/options) for the full list of `generate()` options.

## License

Apache-2.0 © Aviasole Technologies
