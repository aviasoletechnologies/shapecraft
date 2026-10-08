# Schema Inputs

Shapecraft accepts five schema types - not just Zod.

## Zod Schema

```typescript
import { z } from "zod";

const schema = z.object({ name: z.string(), score: z.number() });
const result = await generate(model, schema, prompt);
```

## Raw JSON Schema

```typescript
const result = await generate(model, {
  jsonSchema: {
    type: "object",
    properties: { name: { type: "string" }, score: { type: "number" } },
    required: ["name", "score"],
  },
}, prompt);
```

With `llamaCpp()`, both Zod schemas and `{ jsonSchema }` inputs are converted to
node-llama-cpp's JSON Schema grammar and constrained during token generation.
That converter supports a subset of JSON Schema. Shapecraft still runs its
post-generation validation, but keywords outside the grammar converter's
supported subset are not guaranteed to be enforced during generation.

## Regex Pattern

```typescript
// Model must return a string matching the pattern
const result = await generate(model, {
  pattern: /^\d{4}-\d{2}-\d{2}$/,
}, "What is today's date?");

console.log(result.data); // "2025-01-15"
```

## Custom Validator

```typescript
const result = await generate(model, {
  validate: (output) => typeof output === "object" && output !== null && "id" in output,
  hint: { type: "object", properties: { id: { type: "string" } } },
}, prompt);
```

## XML

You provide an example XML template - the model fills it in. By default
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

### Template rules

**1. Only `{string}`, `{number}`, `{boolean}` are valid inside `{}`.**
Anything else wrapped in braces throws before the model is ever called - a
typo'd placeholder is a template bug, not something worth retrying.

```typescript
import { xmlType } from "@aviasole/shapecraft";

xml: { template: `<book edition="${xmlType.string}">...` }   // fine
xml: { template: `<book edition="{strng}">...` }             // throws immediately:
// "Invalid placeholder(s) in xml.template: {strng}. Only {string}, {number},
//  and {boolean} are recognized (see xmlType)."
```

**2. Text with no `{}` at all is a literal - reproduced as-is, best-effort.**
The model is instructed to leave it untouched, and usually does. But text that
*reads* like an instruction (a description, a placeholder-shaped phrase) can
still get "helpfully" rewritten by the model - that's an LLM judgment call, not
something a validator can catch, since there's no syntax marking it special.

```typescript
xml: { template: `<book status="in-stock">...` }
// "in-stock" is fixed content - usually passed through unchanged
```

If a value must be **guaranteed** unchanged, use `enforceLiterals` (below) - or
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

**4. Namespaces and prefixes are literal text - write them however you need.**

```typescript
xml: {
  template: `<xs:catalog xmlns:xs="http://example.com"><xs:book>{string}</xs:book></xs:catalog>`,
  required: ["xs:book"],
}
```

**5. For repeated elements, show one example - the model repeats the tag.**
Use `arrays` to force single-item results into an array under `parse: true`.

```typescript
xml: {
  template: `<library><book><title>{string}</title></book></library>`,
  arrays: ["book"], // parse:true → library.book is always an array, even with 1 result
}
// model output: <library><book>...</book><book>...</book></library>
```

**6. `required` names must be present *and non-empty*, or the call retries - matched at any depth.**

```typescript
xml: { template: `<order><id>{string}</id><items>{string}</items></order>`, required: ["id", "items"] }
// <order><id>ORD-1</id><items></items></order>  → retries (items is empty)
```

**7. `enforceLiterals: true` guarantees literal fidelity, deterministically.**
Every non-`{}` value in the template is force-corrected in the output - even
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

**8. The `<?xml ...?>` prolog is stripped by default - set `prolog: true` to keep it.**
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

### `xml` options reference

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

## GBNF grammar

Pass a raw [GBNF](https://github.com/ggerganov/llama.cpp/blob/master/grammars/README.md)
(GGML BNF) grammar string. `result.data` is the **raw string** that conforms to the
grammar - GBNF describes a string language, not a JSON shape, so it's never parsed.

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

**The guarantee is backend-dependent - this is the one input where that's true.** On
`llamaCpp()` the grammar is enforced at the **token level**: the model literally cannot
emit a token that breaks the grammar, so the output is valid *by construction*
(`constrained`). On `fireworks()`, grammar mode is also a genuine token-level
constraint, applied server-side. On every other backend (`openai`, `groq`, `mistral`,
`anthropic`, `openRouter`, `deepseek`, `gemini`, `ollama`, `together`, `cerebras`, `grok`,
`openaiCompatible`) there is no grammar
parameter, so the grammar is injected into the prompt (best-effort) and the returned
string is validated against the grammar by a **bundled GBNF interpreter**, then
retried on a mismatch.

```typescript
import { llamaCpp } from "@aviasole/shapecraft";

const local = llamaCpp({ modelPath: "./models/llama-3.2-3b.gguf" }); // npm install node-llama-cpp
const { data } = await generate(local, {
  gbnf: `root ::= "positive" | "negative" | "neutral"`,
}, "Sentiment of: 'I love this!'");
// data: "positive" - constrained, cannot be anything else
```

### What the interpreter enforces (and what it doesn't)

The bundled interpreter is a deliberate **subset**, in the same spirit as `checkJsonSchema`
(a useful subset of JSON Schema, not the whole spec). A malformed grammar, or one using an
unsupported construct, throws **before the model is ever called** - a grammar bug, not
something to retry.

| GBNF construct | Supported |
|---|---|
| String literals, rule references, sequences | Yes |
| Alternation `\|`, grouping `( )` | Yes |
| Repetition `*` `+` `?` `{m}` `{m,}` `{m,n}` | Yes |
| Character classes `[a-z]` `[^0-9]`, ranges, escapes (`\n \t \" \xNN \uNNNN`) | Yes |
| `#` line comments | Yes |
| **Left-recursive rules** | Partial - validation may reject; never hangs |
| **Deeply right-recursive rule *references*** (`list ::= item "," list \| item`) | Partial - has a real depth limit (see below) |
| Nested/imported grammars, llama.cpp extensions | No - throws at parse time |

The subset applies on **all** backends, including `llamaCpp()` (the JS validation still runs
for pipeline uniformity). As always, the grammar constrains **shape, not truth** - a
conforming string can still be a wrong answer (see [Guarantees](/reference/guarantees)).

**Stress-tested failure modes (what actually breaks, found by deliberately trying to break it):**

- **Catastrophic/exponential backtracking - not reproducible.** The classic patterns that
  blow up naive backtracking regex engines (e.g. `("a" "a"?)* "b"` against a long run of `a`
  with no trailing `b`) resolve in milliseconds here, because the matcher dedupes by
  *position reached*, not by path taken - it's closer to a bounded reachability search than
  a naive backtracker.
- **A genuinely adversarial grammar can still exceed the step budget** - a ~26-way
  variable-length ambiguous alternation over a 300k-character input with an unmatchable
  terminator trips it in well under a second, throwing a clear "step budget" error rather
  than hanging. This is a real, if hard-to-reach, backstop - not just an untested code path.
- **Deep right-recursion via a rule *reference* has a hard limit - this is a real gap, not
  just theoretical.** `*` and `+` are matched iteratively (no recursion, no limit tested up to
  50k+ repetitions). But a rule written as `list ::= item "," list | item` recurses through
  the JS call stack once per repetition, and breaks - empirically, somewhere in the
  900-1000 repetition range on a typical build. Past that point `matchesGbnf` throws a clear,
  actionable error (*"GBNF grammar recursion is too deep... prefer `*`/`+`"*) instead of a raw
  native stack-overflow trace. **If your grammar needs a long repeated sequence, write it
  with `*`/`+`, not recursive rule references** - this is the one place "conventionally
  right-recursive GBNF" needs a caveat.
