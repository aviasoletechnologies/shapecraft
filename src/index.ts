export { generate } from "./core/generate.js";
export { generateStream } from "./core/stream.js";
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
  StreamEvent,
  StreamHandle,
} from "./types.js";

export { SchemaViolationError, MaxRetriesExceededError, MaxTurnsExceededError } from "./types.js";
