import type { GenerateOptions, GenerateResult, SchemaInput, ShapecraftModel } from "../types.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../types.js";
import { validateOutput } from "./validate.js";

export async function generate<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult<T>> {
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await model.generate<T>(prompt, schema);
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
