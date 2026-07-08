export { generate } from "./core/generate.js";
export { generateStream } from "./core/stream.js";
export { toJsonSchema, buildStructuredPrompt } from "./core/schema.js";
export { xmlType, validateXmlTemplate } from "./core/xml.js";
export { createConversationMemory, COMPLETION_SENTINEL } from "./core/turnaround.js";
export { createClient } from "./core/client.js";
export { composeMiddleware, loggingMiddleware } from "./core/middleware.js";
export { checkJsonSchema } from "./core/validate.js";

export * from "./backends/index.js";

export type {
  ShapecraftModel,
  ModelCallOptions,
  SchemaInput,
  GenerateOptions,
  GenerateResult,
  ResultMetadata,
  JsonSchemaValidator,
  GuaranteeLevel,
  XmlInput,
  ChatMessage,
  ConversationMemory,
  TurnaroundOptions,
  TurnResult,
  StreamEvent,
  StreamHandle,
} from "./types.js";

export type { CreateClientOptions, ShapecraftClient } from "./core/client.js";
export type { Middleware, MiddlewareContext, NextFn } from "./core/middleware.js";

export { SchemaViolationError, MaxRetriesExceededError, MaxTurnsExceededError, TimeoutError } from "./types.js";
