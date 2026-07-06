# Changelog

## [2.0.3] - 2026-07-06

### Added
- **`ShapecraftModel.capabilities`** - `{ streaming, chat, structuredOutput, toolCalling }`,
  an explicit alternative to duck-typing `typeof model.generateStream === "function"`
  for routing logic. Populated on all 4 built-in backends (`streaming`/`chat`/
  `structuredOutput` true, `toolCalling` false - no backend supports tool calling
  yet). Optional field, so any pre-existing custom `ShapecraftModel` implementation
  without it still satisfies the interface unchanged.

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
- This branch (`architecture-hardening`) was cut from `main` at the stream-support
  merge point, independent of the (still unmerged) fhir-support/gbnf-support
  branches — those lineages will need reconciling on merge.

## [2.0.1] - 2026-07-04

### Added
- `generateStream()` — streams tokens live for UX while validating the assembled
  response exactly once, through the same pipeline as `generate()`.
- `StreamHandle` with two independent views: `textStream` (raw text deltas) and
  `events` (full lifecycle: `attempt-start`, `delta`, `partial`, `attempt-failed`, `done`).
- Incremental per-field validation (`partial` events) — for JSON/Zod object schemas,
  each top-level field is validated the instant its own value closes in the stream,
  before the whole object finishes.
- Visible retries — a streaming attempt that fails validation emits `attempt-failed`
  and starts a fresh `attempt-start`, since already-streamed tokens can't be un-sent.
- `generateStream()` added to all four backends (openai, groq, anthropic, ollama),
  falling back to one-shot `generate()` for a model without native streaming support.
- `checkJsonSchema` exported from `core/validate.ts` for reuse by the incremental validator.

## [0.1.0] - 2026-06-30

### Added
- `generate()` core function with retry loop and guarantee levels
- Backends: `openai` (native), `groq` (native), `ollama` (constrained), `anthropic` (best-effort)
- Schema inputs: Zod, raw JSON Schema, regex pattern, custom validator
- `SchemaViolationError` and `MaxRetriesExceededError`
- ESM + CJS dual output via tsup
- TypeScript declarations
