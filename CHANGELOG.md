# Changelog

## [0.1.0] - 2026-06-30

### Added
- `generate()` core function with retry loop and guarantee levels
- Backends: `openai` (native), `groq` (native), `ollama` (constrained), `anthropic` (best-effort)
- Schema inputs: Zod, raw JSON Schema, regex pattern, custom validator
- `SchemaViolationError` and `MaxRetriesExceededError`
- ESM + CJS dual output via tsup
- TypeScript declarations
