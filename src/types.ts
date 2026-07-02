import { z } from "zod";

export type GuaranteeLevel = "constrained" | "native" | "best-effort";

export type JsonSchemaInput = { jsonSchema: Record<string, unknown> };
export type PatternInput = { pattern: RegExp };
export type ValidatorInput = { validate: (output: unknown) => boolean; hint?: Record<string, unknown> };

export type XmlInput = {
  xml: {
    /** Example XML with {string} / {number} / {boolean} placeholders. */
    template: string;
    /** Node names that must be present and non-empty in the output, else retry. */
    required?: string[];
    /** Node names to always coerce into arrays when parsing. */
    arrays?: string[];
    /** Return the parsed object instead of the validated XML string (the default). */
    parse?: boolean;
    /** Keep an <?xml ...?> prolog if the model adds one (default: stripped). */
    prolog?: boolean;
    /**
     * Force every non-placeholder (literal) value in the template to appear
     * unchanged in the output, regardless of what the model returns for it.
     * Re-serializes the output from a reconciled tree, so formatting
     * (whitespace, attribute order) may differ from the model's raw text.
     */
    enforceLiterals?: boolean;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaInput<T = unknown> = z.ZodType<T> | JsonSchemaInput | PatternInput | ValidatorInput | XmlInput;

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
