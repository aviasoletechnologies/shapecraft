# Options

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
| `timeoutMs` | bound a single attempt's wall-clock time - see [Timeouts & Cancellation](/guide/timeouts-cancellation) |
| `signal` | an `AbortSignal` to cancel an in-flight attempt - see [Timeouts & Cancellation](/guide/timeouts-cancellation) |
| `jsonSchemaValidator` | override the built-in `jsonSchema` structural check - see [Pluggable JSON Schema Validation](/guide/pluggable-validation) |
| `semanticValidator` | content/grounding check after structural validation passes - see [Staged Validation Pipeline](/guide/staged-validation-pipeline) |
| `confidenceScorer` | assigns a 0-1 score to `result.confidence` - see [Staged Validation Pipeline](/guide/staged-validation-pipeline) |
| `minConfidence` | fails and retries the attempt if `confidenceScorer`'s score is below this |
| `postProcessors` | array of transforms applied in order to an already-validated value - see [Staged Validation Pipeline](/guide/staged-validation-pipeline) |
| `retryDelayMs` | fixed delay or `(failedAttempt) => milliseconds` before the next schema-validation retry; `exponentialBackoff()` provides an optional jittered strategy |
