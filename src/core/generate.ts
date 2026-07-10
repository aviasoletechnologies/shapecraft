import type {
  ConfidenceScorer,
  GenerateOptions,
  GenerateResult,
  PostProcessor,
  ResultMetadata,
  SchemaInput,
  SemanticValidator,
  ShapecraftModel,
  TurnaroundOptions,
  TurnResult,
} from "../types.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../types.js";
import { runValidationPipeline } from "./validate.js";
import { runTurnaround } from "./turnaround.js";
import { createTimeoutGuard } from "./timeout.js";

export function parseProviderModel(id: string): { provider: string; model: string } {
  const idx = id.indexOf(":");
  return idx === -1 ? { provider: id, model: id } : { provider: id.slice(0, idx), model: id.slice(idx + 1) };
}

export function generate<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options?: GenerateOptions
): Promise<GenerateResult<T>>;
export function generate<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options: GenerateOptions,
  turnaround: TurnaroundOptions
): Promise<TurnResult<T>>;
export async function generate<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options: GenerateOptions = {},
  turnaround?: TurnaroundOptions
): Promise<GenerateResult<T> | TurnResult<T>> {
  if (turnaround?.turnaround) {
    return runTurnaround<T>(model, schema, prompt, options, turnaround);
  }

  const maxRetries = options.maxRetries ?? 3;
  const { systemPrompt, timeoutMs, signal, jsonSchemaValidator, semanticValidator, confidenceScorer, minConfidence, postProcessors } =
    options;
  const { provider, model: modelName } = parseProviderModel(model.id);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Fail fast on an already-aborted signal — skip calling the backend
    // entirely rather than invoking it just to have Promise.race discard it.
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

    const t0 = Date.now();
    const { guard, signal: callSignal, cleanup } = createTimeoutGuard(timeoutMs, signal);
    try {
      const raw = await Promise.race([
        model.generate<T>(prompt, schema, systemPrompt, callSignal ? { signal: callSignal } : undefined),
        guard,
      ]);
      const { data, confidence } = await runValidationPipeline<T>(raw, schema, prompt, {
        jsonSchemaValidator,
        semanticValidator: semanticValidator as SemanticValidator<T> | undefined,
        confidenceScorer: confidenceScorer as ConfidenceScorer<T> | undefined,
        minConfidence,
        postProcessors: postProcessors as PostProcessor<T>[] | undefined,
      });
      const metadata: ResultMetadata = { provider, model: modelName, latencyMs: Date.now() - t0 };
      return {
        data,
        guaranteeLevel: model.guaranteeLevel,
        attempts: attempt,
        metadata,
        ...(confidence === undefined ? {} : { confidence }),
      };
    } catch (err) {
      if (!(err instanceof SchemaViolationError)) throw err;
      if (attempt === maxRetries) break;
    } finally {
      cleanup();
    }
  }

  throw new MaxRetriesExceededError(maxRetries);
}
