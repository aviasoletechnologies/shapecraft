export { generate } from "./core/generate.js";
export { toJsonSchema, buildStructuredPrompt } from "./core/schema.js";
export { xmlType, validateXmlTemplate } from "./core/xml.js";
export { createConversationMemory, COMPLETION_SENTINEL } from "./core/turnaround.js";

export * from "./backends/index.js";

export type {
  ShapecraftModel,
  SchemaInput,
  GenerateOptions,
  GenerateResult,
  GuaranteeLevel,
  XmlInput,
  ChatMessage,
  ConversationMemory,
  TurnaroundOptions,
  TurnResult,
} from "./types.js";

export { SchemaViolationError, MaxRetriesExceededError, MaxTurnsExceededError } from "./types.js";
