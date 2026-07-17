# Changelog

## [2.3.0] - 2026-07-16

### Added

- **FHIR `Extension` support** - every R4 preset (`Patient`, `Observation`, `Condition`,
  `MedicationRequest`, `Encounter`) now accepts an optional `extension?: Extension[]`. Common-
  subset `Extension` type covers `url` plus `valueString`/`valueInteger`/`valueBoolean`/
  `valueCodeableConcept` - real FHIR's `value[x]` has ~20 polymorphic variants; unsupported
  ones pass through unvalidated (no `oneOf` support in `checkJsonSchema`) rather than being
  rejected.

## [2.2.0] - 2026-07-10

### Added

- Raw GBNF grammar input - `generate(model, { gbnf: grammarString }, prompt)`. Output is the
  raw string that conforms to the grammar.
- `llamaCpp()` backend (node-llama-cpp) - applies a GBNF grammar at the token level, so
  output is valid by construction (`constrained`).
- Bundled pragmatic GBNF interpreter (`matchesGbnf`, `parseGbnf`, `buildGbnfSystemPrompt`
  exported) - validates grammar output on backends without a native grammar parameter, and
  fails fast on a malformed grammar before any model call.
- Streaming for `{ gbnf }` emits `delta`/`done` only (no per-field `partial`), consistent
  with other string-language inputs.

### Fixed

- `checkJsonSchema` enforces `required` fields as present AND non-empty, matching the XML
  validation path - stops a constrained grammar from satisfying a required field with an
  empty `""`/`[]`/`{}`.
- `groq()` no longer forces `response_format: json_object` for `{ gbnf }` inputs (it already
  skipped this for `{ xml }`, but not `gbnf`) - Groq's API rejects json_object mode outright
  when the prompt doesn't contain the word "json", which broke every gbnf call on this
  backend. Fixed in both `generate()` and `generateStream()`.
- `matchesGbnf` now throws a clear, actionable error ("recursion is too deep... prefer
  `*`/`+`") when a deeply right-recursive rule reference exceeds the JS call stack
  (empirically ~900-1000 repetitions), instead of letting a raw native stack-overflow
  `RangeError` propagate.

## [2.1.0] - 2026-07-10

### Added

- FHIR R4 preset schemas via `@aviasole/shapecraft/fhir` entrypoint - Patient, Observation,
  Condition, MedicationRequest, Encounter. Each is a ready-to-use `SchemaInput` with a typed
  result interface, so it works with `generate()`/`generateStream()` unchanged.

## [2.0.4] - 2026-07-10

### Added

- **Staged validation pipeline** - `generate()`'s validation step is now
  `parse → structural validation → semantic validation → confidence scoring →
  post-processors → return`. Structural validation (`validateOutput`) is
  unchanged and remains the only required stage; the three new stages are
  opt-in via `GenerateOptions` (also settable as `createClient()` defaults,
  same override pattern as `jsonSchemaValidator`):
  - `semanticValidator(value, { prompt })` - a content/meaning check that runs
    after structural validation passes. Throw to fail; the failure is wrapped
    in `SchemaViolationError` so it retries exactly like a structural failure.
  - `confidenceScorer(value, { prompt })` - returns a 0-1 score, exposed as
    `GenerateResult.confidence`. Purely informational unless `minConfidence`
    is also set, in which case a score below the threshold fails the attempt
    and retries.
  - `postProcessors: PostProcessor[]` - run last, in array order, reshaping
    an already-validated value (normalization, enrichment, etc). Never
    retried - only runs once every check has already passed.

  Wired into `generate()` only; `generateStream()`'s per-field incremental
  validation is untouched (deferred to the streaming parser refactor).

## [2.0.3] - 2026-07-06

### Added
- **`ShapecraftModel.capabilities`** - `{ streaming, chat, structuredOutput, toolCalling }`,
  an explicit alternative to duck-typing `typeof model.generateStream === "function"`
  for routing logic. Populated on all 4 built-in backends (`streaming`/`chat`/
  `structuredOutput` true, `toolCalling` false - no backend supports tool calling
  yet). Optional field, so any pre-existing custom `ShapecraftModel` implementation
  without it still satisfies the interface unchanged.
- **`generateBatch()` / `client.generateBatch()`** - runs multiple independent
  `{ model, schema, prompt, options? }` items in parallel, capped at
  `concurrency` in flight at once (uncapped if omitted). Each item settles
  independently (`Promise.allSettled`-style, not `Promise.all`-style), so one
  failing item never loses the results of the rest of the batch. Result order
  always matches input order regardless of completion order.
  `client.generateBatch()` routes each item through the client's own
  `generate()`, so middleware and client-level retry/timeout/validator
  defaults apply per item, same as a single call.

### Fixed
- **XML `required` validation missed empty nodes that also carry an attribute**
  - `<title lang="en"></title>` parses to `{ "@_lang": "en" }`, which has a key
  and was wrongly treated as non-empty even though its actual text content is
  blank. `isNonEmpty()` now excludes attribute keys (`@_`-prefixed) from the
  "has content" check, so a required node with only an attribute and no real
  text correctly fails validation and retries, instead of silently passing.

## [2.0.2] - 2026-07-06

### Added
- **`createClient()` + middleware pipeline** — `createClient({ middleware, retry, timeoutMs, jsonSchemaValidator })`
  wraps `generate()`/`generateStream()` with a Koa-style onion middleware chain
  (`composeMiddleware`, `loggingMiddleware` exported) for logging/caching/telemetry.
  Purely additive: existing direct calls to `generate()`/`generateStream()` are
  completely unaffected — this is a new, optional entry point, not a replacement.
- **`GenerateResult.metadata`** — every result now includes
  `{ provider, model, latencyMs, tokens?, finishReason?, requestId?, cost? }`.
  `provider`/`model`/`latencyMs` are always populated by the core; the rest stay
  `undefined` until a backend opts in to supplying them.
- **`timeoutMs` / `signal` on `GenerateOptions`** — a single attempt can now be
  bounded by a timeout or cancelled via `AbortSignal`, surfaced as the new
  `TimeoutError`. Enforced at the core level for every backend (the retry loop
  always stops waiting), and threaded through to all four built-in backends
  for real request cancellation, not just abandonment.
- **Pluggable `jsonSchemaValidator`** — override the built-in shallow
  `{ jsonSchema }` structural check (e.g. swap in AJV) via
  `GenerateOptions.jsonSchemaValidator`. Applies to both `generate()`'s final
  check and `generateStream()`'s per-field incremental validation. Omitting it
  keeps today's built-in `checkJsonSchema` behavior unchanged.
- `ModelCallOptions` — new optional 4th parameter on `ShapecraftModel.generate()`/
  `generateStream()` carrying `{ signal }`. Backends that don't declare it still
  satisfy the interface and behave exactly as before.

### Fixed
- **`isZodSchema()` dual-package-hazard** — replaced `schema instanceof z.ZodType`
  with a duck-typed check (`_def` + `parse`/`safeParse`). A consumer whose zod
  install resolves to a different module instance or major version than the one
  in shapecraft's own dependency tree (e.g. a `file:`-linked local package, or a
  nested zod copy pulled in transitively by another dependency) would silently
  hit "Unknown schema type" for every Zod schema, since `instanceof` compared
  against the wrong class. Affected `core/validate.ts`, `core/schema.ts`,
  `core/incremental.ts`, `core/turnaround.ts`.

### Notes
- `createClient()`'s middleware wraps `generate()` only; `generateStream()` gets
  the client's retry/timeout/validator defaults but not middleware interception
  (its async-iterable shape doesn't fit the simple before/after model — see the
  streaming-parser-refactor item in PLAN-Updated.md). `turnaround` calls are also
  out of scope for the client wrapper in v1 — use top-level
  `generate(..., { turnaround: true })`.

## [2.0.1] - 2026-07-04

### Added
- `generateStream()` - streams tokens live for UX while validating the assembled response
  exactly once, through the same pipeline as `generate()`.
- `StreamHandle` with two independent views: `textStream` (raw text deltas) and `events`
  (full lifecycle: `attempt-start`, `delta`, `partial`, `attempt-failed`, `done`).
- Incremental per-field validation (`partial` events) - for JSON/Zod object schemas, each
  top-level field is validated the instant its own value closes in the stream, before the
  whole object finishes.
- Visible retries - a streaming attempt that fails validation emits `attempt-failed` and
  starts a fresh `attempt-start`, since already-streamed tokens can't be un-sent.
- `generateStream()` added to all four backends (openai, groq, anthropic, ollama), falling
  back to one-shot `generate()` for a model without native streaming support.
- `checkJsonSchema` exported from `core/validate.ts` for reuse by the incremental validator.

## [0.1.0] - 2026-06-30

### Added
- `generate()` core function with retry loop and guarantee levels
- Backends: `openai` (native), `groq` (native), `ollama` (constrained), `anthropic` (best-effort)
- Schema inputs: Zod, raw JSON Schema, regex pattern, custom validator
- `SchemaViolationError` and `MaxRetriesExceededError`
- ESM + CJS dual output via tsup
- TypeScript declarations
