import { z } from "zod";
import type {
  ConfidenceScorer,
  GbnfInput,
  JsonSchemaValidator,
  OpenApiInput,
  PostProcessor,
  SchemaInput,
  SemanticValidator,
  XmlInput,
  YamlInput,
} from "../types.js";
import { SchemaViolationError } from "../types.js";
import { finalizeXmlOutput } from "./xml.js";
import { matchesGbnf } from "./gbnf.js";
import { checkJsonSchema } from "./jsonSchemaCheck.js";
import { finalizeYamlOutput } from "./yaml.js";

export { checkJsonSchema };

// Duck-typed rather than `instanceof z.ZodType`: a `file:`-linked or
// nested-install consumer can end up with a different zod module instance
// (or major version) than the one this schema was built with, which makes
// `instanceof` false even for a genuine Zod schema. `_def`/`parse`/`safeParse`
// are present on every ZodType across zod v3 and v4, and none of the other
// SchemaInput shapes (jsonSchema/pattern/validate/xml) have all three.
export function isZodSchema(schema: SchemaInput): schema is z.ZodType<any> {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "_def" in schema &&
    typeof (schema as { parse?: unknown }).parse === "function" &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  );
}

export function isXmlInput(schema: SchemaInput): schema is XmlInput {
  return typeof schema === "object" && schema !== null && "xml" in schema;
}

export function isGbnfInput(schema: SchemaInput): schema is GbnfInput {
  return typeof schema === "object" && schema !== null && "gbnf" in schema;
}

export function isYamlInput(schema: SchemaInput): schema is YamlInput {
  return typeof schema === "object" && schema !== null && "yaml" in schema;
}

// An OpenApiInput is resolved to a plain `{ jsonSchema }` input before it ever
// reaches validateOutput/parseAndValidate — this guard exists only so
// generate() can detect and resolve it upfront (see openapi.ts).
export function isOpenApiInput(schema: SchemaInput): schema is OpenApiInput {
  return typeof schema === "object" && schema !== null && "openapi" in schema;
}

function nullToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(nullToUndefined);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, nullToUndefined(v)])
    );
  }
  return value;
}

export function validateOutput<T>(
  output: unknown,
  schema: SchemaInput<T>,
  opts: { jsonSchemaValidator?: JsonSchemaValidator | undefined } = {}
): T {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(nullToUndefined(output));
    if (!result.success) throw new SchemaViolationError(JSON.stringify(output), result.error);
    return result.data;
  }

  if ("jsonSchema" in schema) {
    try {
      const validate = opts.jsonSchemaValidator ?? checkJsonSchema;
      validate(output, schema.jsonSchema);
    } catch (err) {
      throw new SchemaViolationError(JSON.stringify(output), err);
    }
    return output as T;
  }

  if ("pattern" in schema) {
    const str = typeof output === "string" ? output : JSON.stringify(output);
    if (!schema.pattern.test(str)) {
      throw new SchemaViolationError(str, `Output does not match pattern ${schema.pattern}`);
    }
    return output as T;
  }

  if (isGbnfInput(schema)) {
    // GBNF output is always a raw string (like `pattern`). On llamaCpp() the
    // grammar was applied at the token level so this is a guaranteed no-op; on
    // any other backend it is the actual structural check.
    const str = typeof output === "string" ? output : JSON.stringify(output);
    if (!matchesGbnf(schema.gbnf, str)) {
      throw new SchemaViolationError(str, "Output does not conform to the GBNF grammar");
    }
    return str as T;
  }

  if ("validate" in schema) {
    if (!schema.validate(output)) {
      throw new SchemaViolationError(JSON.stringify(output), "Custom validator returned false");
    }
    return output as T;
  }

  if (isXmlInput(schema)) {
    if (typeof output === "string") {
      // raw XML string (from mock models, or the default string path) — validate now
      return finalizeXmlOutput<T>(output, schema);
    }
    // already parsed by a real backend — pass through
    return output as T;
  }

  if (isYamlInput(schema)) {
    if (typeof output === "string") {
      // raw YAML string (from mock models, or a backend that doesn't call
      // parseAndValidate itself) — validate now
      return finalizeYamlOutput<T>(output, schema);
    }
    // already parsed by the backend's own parseAndValidate call — pass through
    return output as T;
  }

  throw new Error("Unknown schema type");
}

export interface ValidationPipelineOptions<T> {
  jsonSchemaValidator?: JsonSchemaValidator | undefined;
  semanticValidator?: SemanticValidator<T> | undefined;
  confidenceScorer?: ConfidenceScorer<T> | undefined;
  minConfidence?: number | undefined;
  postProcessors?: PostProcessor<T>[] | undefined;
}

export interface ValidationPipelineResult<T> {
  data: T;
  confidence?: number;
}

/**
 * `parse → structural validation → semantic validation → confidence scoring
 * → post-processors → return`. Structural validation (`validateOutput`
 * above) is the only required stage — every other stage runs only if the
 * caller supplied it, and a stage failure throws `SchemaViolationError` so
 * `generate()`'s retry loop treats it exactly like a structural failure.
 * Post-processors run last and are never retried — they only reshape a
 * value that already passed every check.
 */
export async function runValidationPipeline<T>(
  output: unknown,
  schema: SchemaInput<T>,
  prompt: string,
  opts: ValidationPipelineOptions<T> = {}
): Promise<ValidationPipelineResult<T>> {
  let data = validateOutput<T>(output, schema, { jsonSchemaValidator: opts.jsonSchemaValidator });

  if (opts.semanticValidator) {
    try {
      await opts.semanticValidator(data, { prompt });
    } catch (err) {
      throw new SchemaViolationError(JSON.stringify(data), err);
    }
  }

  let confidence: number | undefined;
  if (opts.confidenceScorer) {
    confidence = await opts.confidenceScorer(data, { prompt });
    if (opts.minConfidence !== undefined && confidence < opts.minConfidence) {
      throw new SchemaViolationError(
        JSON.stringify(data),
        `Confidence score ${confidence} is below minConfidence ${opts.minConfidence}`
      );
    }
  }

  if (opts.postProcessors) {
    for (const postProcess of opts.postProcessors) {
      data = await postProcess(data, confidence === undefined ? { prompt } : { prompt, confidence });
    }
  }

  return confidence === undefined ? { data } : { data, confidence };
}
