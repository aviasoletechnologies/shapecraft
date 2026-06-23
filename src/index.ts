export { generate } from "./core/generate.js";
export { toJsonSchema, resolveJsonSchema, buildStructuredPrompt, validateOutput } from "./core/schema.js";

export { openai } from "./backends/openai.js";
export { ollama } from "./backends/ollama.js";
export { anthropic } from "./backends/anthropic.js";
export { groq } from "./backends/groq.js";

export type {
  ShapecraftModel,
  SchemaInput,
  ZodSchema,
  JsonSchemaInput,
  RegexInput,
  CustomValidatorInput,
  GenerateOptions,
  GenerateResult,
  GuaranteeLevel,
} from "./types.js";

export {
  SchemaViolationError,
  MaxRetriesExceededError,
  isZodSchema,
  isJsonSchemaInput,
  isRegexInput,
  isCustomValidatorInput,
} from "./types.js";
