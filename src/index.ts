export { generate } from "./core/generate.js";
export { toJsonSchema, buildStructuredPrompt } from "./core/schema.js";

export * from "./backends/index.js";

export type {
  ShapecraftModel,
  SchemaInput,
  GenerateOptions,
  GenerateResult,
  GuaranteeLevel,
  XmlObjectInput,
  XmlTemplateInput,
  XmlFields,
  XmlFieldDef,
  XmlFieldType,
} from "./types.js";

export { SchemaViolationError, MaxRetriesExceededError } from "./types.js";
