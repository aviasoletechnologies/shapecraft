# Changelog

## [3.0.0] - 2026-09-17

### Added

- **YAML schema inputs**: describe the target shape with JSON Schema and receive
  validated YAML output, parsed by default or returned as a raw string with `parse: false`.
- **OpenAPI-driven schema inputs**: derive a schema from an OpenAPI 3.x operation by
  `operationId`, using a file path, URL, or parsed specification object.
- OpenAPI request-body and success-response targets, with the same validation and retry
  behavior as other structured schema inputs.

## [2.9.0] - 2026-08-14

### Added

- **Four new backends**, all reached via the `openai` package pointed at a different
  base URL (no new SDK dependency), continuing the `fireworks()`/`mistral()`/
  `openRouter()`/`deepseek()` pattern:
  - **`together()`** - Together AI. `guaranteeLevel: "native"` -
    `response_format: { type: "json_schema", ... }` is server-side enforced, same
    tier as `openai()`/`groq()`/`fireworks()`/`mistral()`.
  - **`cerebras()`** - Cerebras. `guaranteeLevel: "native"`, strict `json_schema`
    mode. Cerebras' strict mode rejects the `format` keyword outright ("Invalid
    fields for schema with types ['string']: {'format'}") - confirmed live. Zod
    v4's native `toJSONSchema()` adds `format: "email"`/`"uri"`/etc. for
    `.email()`/`.url()`/similar refinements, which every other native-tier backend
    accepts fine. The underlying `pattern` regex those refinements also emit still
    enforces the same shape, so `cerebras()` strips `format` before sending -
    loses no real validation, just a hint Cerebras specifically can't parse.
  - **`grok()`** - xAI. `guaranteeLevel: "native"`, same server-side `json_schema`
    enforcement. Exported as `grok()` rather than `xai()` - matches this repo's
    convention of naming after the product users search for (`gemini()` not
    `google()`).
  - **`openaiCompatible()`** - generic escape hatch for any OpenAI-compatible
    endpoint shapecraft doesn't name explicitly. `baseURL`, `apiKey`, and `model`
    are all caller-supplied instead of hardcoded; no environment-variable fallback
    for the API key exists for an arbitrary provider, so `apiKey` is required (both
    at the type level and by a runtime guard). Defaults to `guaranteeLevel:
    "best-effort"` since shapecraft can't verify an arbitrary endpoint actually
    enforces `json_schema` server-side - pass `guaranteeLevel: "native"` explicitly
    if you know your provider does.
  - None of the four expose a genuine grammar/constrained-decoding mode, so a
    `{ gbnf }` input on any of them is prompt-only best-effort, same as
    `openai()`/`groq()`. None implement `toolCall()` yet -
    `capabilities.toolCalling` is `false` on all four, unlike the nine backends
    that gained it in 2.8.0 - the same `openAiCompatibleToolCall()` helper those
    reuse would apply here too, just not wired up in this release.
  - `together()`/`cerebras()`/`grok()` guard against the `openai` package's silent
    fallback to `OPENAI_API_KEY` when a provider-specific key is unset, same
    regression class `deepseek()` already guards against - each throws a clear
    "Missing ... API key" error instead of silently authenticating against the
    wrong provider.

## [2.8.0] - 2026-07-31

### Added

- **Native tool/function-calling** - `generateWithTools(model, tools, schema, prompt, options?)`.
  Passes the running message history plus your tool definitions to the model's own
  `toolCall()` turn, executes requested tools locally (validating each call's arguments
  against that tool's `parameters` schema first), feeds results back, and repeats until
  the model stops asking for tools. The final answer is extracted through an ordinary
  `generate()` call over the transcript, so the structured-output guarantee is identical
  to any standalone `generate()` - not a weaker tool-calling-specific check.
  - A bad tool call (unknown name, or arguments that fail the tool's schema) is fed back
    to the model as a `tool` error message so it can retry - re-prompting can fix that.
    A handler that throws is not recoverable that way, so it aborts immediately with
    `ToolExecutionError`. Exceeding `maxTurns` (default 10) throws
    `MaxToolTurnsExceededError`.
  - `ToolDefinition.parameters` accepts Zod or `{ jsonSchema }` only. `pattern`/`validate`/
    `xml` have no sensible named-parameters representation and throw clearly instead of
    silently producing a broken tool definition.
  - Available on every backend except `llamaCpp()` (local GGUF inference exposes no
    tools API). `openai()`, `groq()`, `fireworks()`, `mistral()`, `openRouter()` and
    `deepseek()` share one `openAiCompatibleToolCall()` implementation (identical wire
    format); `anthropic()`, `ollama()` and `gemini()` each have their own.
    `ModelCapabilities.toolCalling` reports this per backend - check the flag rather
    than hardcoding the list.
  - `gemini()` needs its own path: `@google/genai` models a tool turn as
    `functionCall`/`functionResponse` Parts inside `contents` rather than OpenAI's flat
    `tool_calls` array, uses `parametersJsonSchema` (plain JSON Schema) over the older
    Type-enum `parameters`, and rejects a replayed `functionCall` Part that has lost its
    opaque `thoughtSignature`. That token has no home on the shared `ToolCall` type, so
    the backend keeps it per model instance and reattaches it on the next turn.
  - Live-verified against Groq, Anthropic, Mistral and Gemini. `fireworks()`,
    `openRouter()` and `deepseek()` take the identical OpenAI-compatible code path but
    had no usable credentials to test against.

### Fixed

- **`llamaCpp()` declared no `capabilities` object at all** - the only backend that
  didn't, so `model.capabilities` was `undefined` there while every other backend
  returned one. It now reports `streaming: false`/`toolCalling: false` explicitly
  (no token-delta iterator, no tools API) rather than saying nothing.
- `ModelCapabilities.toolCalling`'s doc comment still read "Not yet built by any
  backend", which shipped to consumers in the generated `.d.ts`.

### Fixed

- `toJsonSchema()` now strips `$schema` on the Zod v4 path too, not just the
  `zod-to-json-schema` fallback. Zod v4's native `toJSONSchema()` emits its own
  draft-2020-12 `$schema` key, which would otherwise reach backends that reject
  extraneous top-level schema keys.

## [2.7.0] - 2026-07-31

### Added

- Multi-agent orchestration via `@aviasole/shapecraft/agentic` entrypoint - `defineAgent()` +
  `runAgents()`. Chains sequential, dependent `generate()` calls (each with its own
  model/schema/role), threading one step's *validated* output into the next via a
  caller-written `router` function. Each step keeps its own retry/guarantee-level behavior;
  no new validation engine. See README `## Multi-agent orchestration`.
  - `MaxTurnsExceededError` (thrown when a router never returns `"done"` within `maxTurns`)
    is re-exported from the `/agentic` entrypoint, so catching it doesn't require a second
    import from the package root.

### Fixed

- **README had three byte-identical copies of the `## Skill-Based Generation` section**
  (a merge artifact, present since 2.4.0). Removed the two duplicates; no content change to
  the section itself.
- The README's multi-agent example gave its second agent no `buildPrompt`, so that step
  received only the previous step's validated `{ category }` and never saw the original
  request it was supposed to diagnose. The example now carries the original input forward,
  matching what the test suite and the example app actually do.

## [2.6.0] - 2026-07-15

> Also contains everything listed under 2.5.0 below. That version was never published to
> npm, so the five backends and two fixes it documents reached users for the first time in
> this release.

### Added

- **CLI** - `npx shapecraft validate --schema schema.json --output output.json` validates
  an already-produced JSON file against a raw JSON Schema file without writing any code.
  Reuses `checkJsonSchema` (the same structural check `generate()` uses internally) -
  `required` fields must be present and non-empty, `type`/`enum` must match, nested
  `properties`/`items` are checked recursively. Exits `0` and prints `✓ ... matches ...`
  on success; exits `1` with the specific violation on failure. New `bin` entry
  (`src/cli.ts`, built alongside the existing `index`/`fhir` entrypoints) - no new
  dependency, no argument-parsing library.

## [2.5.0] - 2026-07-15 [NOT PUBLISHED]

> **This version was not published to npm** - the registry goes directly from `2.4.0` to
> `2.6.0`. Everything listed below shipped as part of 2.6.0 instead, so install 2.6.0 or
> later to get any of it.

### Added

- **`fireworks()` backend** - Fireworks AI, reached via the `openai` package pointed at
  Fireworks' base URL (no new SDK dependency). `guaranteeLevel: "native"` - JSON/Zod
  schemas use Fireworks' server-side JSON schema mode, same tier as `openai()`/`groq()`.
  - The differentiator: a `{ gbnf }` input gets Fireworks' own grammar mode
    (`response_format: { type: "grammar", grammar }`), a genuine token-level constraint
    applied server-side - not the prompted-and-checked best-effort path every other cloud
    backend falls back to for gbnf. It's the same real guarantee `llamaCpp()` gives
    locally, just without needing a local `.gguf` file.
- **`mistral()` backend** - Mistral AI, same `openai`-package-pointed-at-a-different-base-URL
  approach as `fireworks()`. `guaranteeLevel: "native"` - `response_format: { type:
  "json_schema", ... }` is server-side enforced, same tier as `openai()`/`groq()`/
  `fireworks()`. No grammar mode - a `{ gbnf }` input is prompt-only, best-effort, same
  as `openai()`/`groq()`.
- **`openRouter()` backend** - same `openai`-package-pointed-at-a-different-base-URL
  approach as `fireworks()`/`mistral()`. `guaranteeLevel: "best-effort"`, deliberately
  not `"native"` like the other cloud backends - OpenRouter is pass-through across many
  different underlying providers/models, and `response_format: { type: "json_schema" }`
  enforcement isn't guaranteed for every model it can route to. Defensively requests
  `extractJson: true` on every call for the same reason `anthropic()` needs it. No
  grammar mode - a `{ gbnf }` input is prompt-only, best-effort.
- **`gemini()` backend** - Google Gemini, via the official `@google/genai` SDK rather
  than `openai`-pointed-at-a-different-base-URL - Gemini's OpenAI-compatible endpoint is
  a migration bridge for OpenAI users, not its primary integration path, and doesn't
  expose `responseJsonSchema` (plain JSON Schema, what `toJsonSchema()` already produces)
  - only the older `responseSchema` (Gemini's own Type-enum OpenAPI-subset shape).
  `guaranteeLevel: "native"` - `responseJsonSchema`/`responseMimeType: "application/json"`
  is server-side constrained decoding, same tier as `openai()`/`groq()`/`fireworks()`/
  `mistral()`. No grammar mode - a `{ gbnf }` input is prompt-only, best-effort, same as
  every other backend without one.
- **`deepseek()` backend** - DeepSeek, reached via the `openai` package pointed at DeepSeek's
  base URL (no new SDK dependency, same approach as `fireworks()`/`mistral()`/`openRouter()`).
  `guaranteeLevel: "native"` - `response_format: { type: "json_object" }` is a real,
  server-side JSON-mode toggle, same tier as `groq()` - but unlike `fireworks()`/`mistral()`,
  DeepSeek's API only supports `"json_object"` (valid JSON), not a schema-strict
  `"json_schema"` mode. Requires the literal word "json" in the prompt for `json_object`
  mode to behave, same restriction as `groq()`. No grammar mode - a `{ gbnf }` input is
  prompt-only, best-effort, same as every other backend without one. Defaults to
  `deepseek-v4-flash` - `deepseek-chat`/`deepseek-reasoner` are deprecated 2026-07-24 in
  favor of `deepseek-v4-flash` (non-thinking) / `deepseek-v4-pro` (thinking).

### Fixed

- **`matchesGbnf`'s right-recursion depth limit is now enforced by the matcher, not by the
  JS call stack.** It previously had no explicit limit at all - the "limit" was a native
  stack-overflow `RangeError` being caught and re-thrown with a friendlier message, so the
  actual cutoff varied with the platform, Node version and worker-thread stack size (under
  5k nested references on some builds, past 8k on others). Rule references are now capped at
  1000, giving the identical cutoff everywhere and failing fast instead of grinding for
  seconds near the stack ceiling first. The `*`/`+` forms remain iterative and uncapped.
- **`toJsonSchema()` emitted the legacy OpenAPI 3.0 boolean form for exclusive bounds**
  (`.positive()`/`.negative()`/`.gt()`/`.lt()`) - `exclusiveMinimum: true` + a separate
  `minimum`, instead of the numeric form real JSON Schema requires (`exclusiveMinimum: 0`).
  Backends that validate the schema itself strictly (confirmed on Mistral, which rejected
  it outright with a 422) reject the boolean form before the model ever runs. Switched
  `zodToJsonSchema`'s target from `openApi3` to `jsonSchema7` (stripping the extraneous
  `$schema` key it adds). Affects every backend's Zod-schema handling, not just Mistral -
  verified live against `groq()`, `anthropic()`, and `ollama()` with the schema that broke
  Mistral.

## [2.4.0] - 2026-07-17

### Added

- **Skill-based generation** - let the model pick which of several registered typed
  operations to run, with validated arguments, instead of always extracting one fixed
  shape.
  - `SkillRegistry` - register a skill as `{ name, description?, inputSchema, handler,
    terminal? }`. `inputSchema` is Zod-only in v1 - that's the mechanism that lets the
    dispatch schema be built as a `z.discriminatedUnion` with zero new validation code.
  - `generateSkillCall(model, registry, prompt, options?)` - builds the dispatch schema
    from the registry and calls `generate()`, returning `{ skill, args }`. A thin
    wrapper, not a separate mechanism: same retry loop, same `guaranteeLevel` semantics
    per backend as any other `generate()` call. Deliberately not built on any
    provider's native tool-calling API - those don't exist on Ollama or `llamaCpp()` at
    all, so this is what makes dispatch work identically across every backend.
  - `runSkill(registry, call)` - the executor. Throws `SkillExecutionError` (not
    `SchemaViolationError`) if the handler itself throws - a business-logic failure,
    never retried the way a structural failure is.
  - `runSkillLoop(model, registry, goal, options?)` - repeatedly dispatches + runs a
    skill, feeding results back as context, until a skill marked `terminal: true`
    succeeds or `maxTurns` is hit (`MaxSkillTurnsExceededError`, carrying the loop's
    `memory` so a caller can resume with a fresh turn budget). A handler failure -
    including the terminal skill's own - is recorded as an error turn and fed back to
    the model rather than aborting the loop.
  - New `ModelCapabilities.skillDispatch: boolean`, `true` on all 4 built-in backends.
    `toolCalling` is untouched - it keeps meaning native provider function-calling, a
    different, still-unbuilt thing.

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
