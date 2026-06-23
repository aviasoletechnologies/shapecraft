import { z } from "zod";

export type GuaranteeLevel = "constrained" | "native" | "best-effort";

/** Zod schema */
export type ZodSchema = z.ZodType<any>;

/** Raw JSON Schema object */
export interface JsonSchemaInput {
  jsonSchema: Record<string, unknown>;
}

/** Regex pattern — model must return string matching pattern */
export interface RegexInput {
  pattern: RegExp | string;
}

/** Custom validator function */
export interface CustomValidatorInput {
  validate: (output: unknown) => boolean;
  /** Optional JSON schema hint to guide the model */
  hint?: Record<string, unknown>;
}

export type SchemaInput =
  | ZodSchema
  | JsonSchemaInput
  | RegexInput
  | CustomValidatorInput;

export interface ShapecraftModel {
  id: string;
  guaranteeLevel: GuaranteeLevel;
  generate<T>(prompt: string, schema: SchemaInput): Promise<T>;
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

// Type guards
export function isZodSchema(s: SchemaInput): s is ZodSchema {
  return typeof (s as any).safeParse === "function";
}

export function isJsonSchemaInput(s: SchemaInput): s is JsonSchemaInput {
  return typeof (s as any).jsonSchema === "object";
}

export function isRegexInput(s: SchemaInput): s is RegexInput {
  return (s as any).pattern instanceof RegExp || typeof (s as any).pattern === "string";
}

export function isCustomValidatorInput(s: SchemaInput): s is CustomValidatorInput {
  return typeof (s as any).validate === "function";
}
