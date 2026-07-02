export { generate } from "./core/generate.js";
export { toJsonSchema, buildStructuredPrompt } from "./core/schema.js";
export { xmlType, validateXmlTemplate } from "./core/xml.js";

export * from "./backends/index.js";

export type {
  ShapecraftModel,
  SchemaInput,
  GenerateOptions,
  GenerateResult,
  GuaranteeLevel,
  XmlInput,
} from "./types.js";

export { SchemaViolationError, MaxRetriesExceededError } from "./types.js";
