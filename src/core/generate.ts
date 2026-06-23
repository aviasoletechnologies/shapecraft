import { z } from "zod";
import type { GenerateOptions, GenerateResult, ShapecraftModel } from "../types.js";
import { MaxRetriesExceededError } from "../types.js";

export async function generate<T>(
  model: ShapecraftModel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>,
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
    } catch (err) {
      if (attempt === maxRetries) break;
    }
  }

  throw new MaxRetriesExceededError(maxRetries);
}
