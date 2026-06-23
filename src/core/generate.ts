import type { GenerateOptions, GenerateResult, SchemaInput, ShapecraftModel } from "../types.js";
import { MaxRetriesExceededError } from "../types.js";

export async function generate<T = unknown>(
  model: ShapecraftModel,
  schema: SchemaInput,
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult<T>> {
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await model.generate<T>(prompt, schema);
      return {
        data,
        guaranteeLevel: model.guaranteeLevel,
        attempts: attempt,
      };
    } catch {
      if (attempt === maxRetries) break;
    }
  }

  throw new MaxRetriesExceededError(maxRetries);
}
