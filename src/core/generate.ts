import type {
  GenerateOptions,
  GenerateResult,
  SchemaInput,
  ShapecraftModel,
  TurnaroundOptions,
  TurnResult,
} from "../types.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../types.js";
import { validateOutput } from "./validate.js";
import { runTurnaround } from "./turnaround.js";

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
  const { systemPrompt } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await model.generate<T>(prompt, schema, systemPrompt);
      const data = validateOutput<T>(raw, schema);
      return {
        data,
        guaranteeLevel: model.guaranteeLevel,
        attempts: attempt,
      };
    } catch (err) {
      if (!(err instanceof SchemaViolationError)) throw err;
      if (attempt === maxRetries) break;
    }
  }

  throw new MaxRetriesExceededError(maxRetries);
}
