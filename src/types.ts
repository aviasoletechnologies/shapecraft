import { z } from "zod";

export type GuaranteeLevel = "constrained" | "native" | "best-effort";

export type JsonSchemaInput = { jsonSchema: Record<string, unknown> };
export type PatternInput = { pattern: RegExp };
export type ValidatorInput = { validate: (output: unknown) => boolean; hint?: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaInput<T = unknown> = z.ZodType<T> | JsonSchemaInput | PatternInput | ValidatorInput;

export interface ShapecraftModel {
  id: string;
  guaranteeLevel: GuaranteeLevel;
  generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T>;
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
