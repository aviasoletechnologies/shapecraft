# Changelog

## [2.1.0] - 2026-07-06

### Added
- FHIR R4 preset schemas via `@aviasole/shapecraft/fhir` entrypoint - Patient, Observation,
  Condition, MedicationRequest, Encounter. Each is a ready-to-use `SchemaInput` with a typed
  result interface, so it works with `generate()`/`generateStream()` unchanged.
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
