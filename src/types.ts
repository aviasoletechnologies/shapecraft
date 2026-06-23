import { z } from "zod";

export type GuaranteeLevel = "constrained" | "native" | "best-effort";

export interface ShapecraftModel {
  id: string;
  guaranteeLevel: GuaranteeLevel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generate<T>(prompt: string, schema: z.ZodType<any>): Promise<T>;
}

export interface GenerateOptions {
  maxRetries?: number;
  systemPrompt?: string;
  temperature?: number;
}

export interface GenerateResult<T> {
  data: T;
  guaranteeLevel: GuaranteeLevel;
  attempts: number;
}

export class SchemaViolationError extends Error {
  constructor(
    public readonly raw: string,
    public readonly validationErrors: unknown
  ) {
    super("Model output failed schema validation");
    this.name = "SchemaViolationError";
  }
}

export class MaxRetriesExceededError extends Error {
  constructor(public readonly attempts: number) {
    super(`Schema validation failed after ${attempts} attempts`);
    this.name = "MaxRetriesExceededError";
  }
}
