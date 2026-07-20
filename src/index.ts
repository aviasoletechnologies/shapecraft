export { generate } from "./core/generate.js";
export { generateStream } from "./core/stream.js";
export { generateBatch } from "./core/batch.js";
export { toJsonSchema, buildStructuredPrompt } from "./core/schema.js";
export { xmlType, validateXmlTemplate } from "./core/xml.js";
export { parseGbnf, matchesGbnf, buildGbnfSystemPrompt } from "./core/gbnf.js";
export { createConversationMemory, COMPLETION_SENTINEL } from "./core/turnaround.js";
export { SkillRegistry, generateSkillCall, runSkill, runSkillLoop } from "./core/skills.js";
export { createClient } from "./core/client.js";
export { composeMiddleware, loggingMiddleware } from "./core/middleware.js";
export { checkJsonSchema, runValidationPipeline } from "./core/validate.js";

export * from "./backends/index.js";

export type {
  ShapecraftModel,
  ModelCallOptions,
  ModelCapabilities,
  SchemaInput,
  GenerateOptions,
  GenerateResult,
  ResultMetadata,
  JsonSchemaValidator,
  SemanticValidator,
  ConfidenceScorer,
  PostProcessor,
  GuaranteeLevel,
  XmlInput,
  GbnfInput,
  ChatMessage,
  ConversationMemory,
  TurnaroundOptions,
  TurnResult,
  Skill,
  SkillCall,
  SkillTurn,
  SkillLoopMemory,
  RunSkillLoopOptions,
  StreamEvent,
  StreamHandle,
  BatchItem,
  BatchResult,
  GenerateBatchOptions,
} from "./types.js";

export type { CreateClientOptions, ShapecraftClient } from "./core/client.js";
export type { Middleware, MiddlewareContext, NextFn } from "./core/middleware.js";
export type { ValidationPipelineOptions, ValidationPipelineResult } from "./core/validate.js";

export {
  SchemaViolationError,
  MaxRetriesExceededError,
  MaxTurnsExceededError,
  TimeoutError,
  SkillExecutionError,
  MaxSkillTurnsExceededError,
} from "./types.js";
