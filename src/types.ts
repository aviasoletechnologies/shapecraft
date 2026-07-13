import { z } from "zod";

export type GuaranteeLevel = "constrained" | "native" | "best-effort";

export type JsonSchemaInput = { jsonSchema: Record<string, unknown> };
export type PatternInput = { pattern: RegExp };
export type ValidatorInput = { validate: (output: unknown) => boolean; hint?: Record<string, unknown> };
export type GbnfInput = {
  /**
   * A GBNF (GGML BNF) grammar string. On a llama.cpp-family backend
   * (`llamaCpp()`) it is applied at the token level, so the output is valid by
   * construction (`constrained`). On every other backend it is injected into the
   * prompt (best-effort) and the returned string is validated against the grammar
   * by a bundled pragmatic GBNF interpreter. Output is always the raw matched
   * string — never JSON-parsed.
   */
  gbnf: string;
};

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
export type SchemaInput<T = unknown> = z.ZodType<T> | JsonSchemaInput | PatternInput | ValidatorInput | XmlInput | GbnfInput;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Extra per-call knobs a backend MAY read. Passed as an additional, optional
 * argument — a backend that doesn't declare this parameter at all still
 * satisfies `ShapecraftModel` (TypeScript allows implementing fewer params
 * than an interface declares) and behaves exactly as it did before this
 * existed. Backends that DO read `signal` get real request cancellation;
 * everything else still gets the core-level timeout/abort guarantee (the
 * retry loop stops waiting) even if the underlying call keeps running.
 */
export interface ModelCallOptions {
  signal?: AbortSignal;
}

/**
 * Explicit, inspectable feature flags for a model — an alternative to
 * duck-typing `typeof model.chat === "function"` / `typeof model.generateStream
 * === "function"` for routing logic. Optional so any pre-existing custom
 * `ShapecraftModel` implementation (which predates this field) still
 * satisfies the interface unchanged; the 4 built-in backends always populate
 * it. `chat?`/`generateStream?` themselves are untouched and still the
 * source of truth the core actually calls — `capabilities` is a declared
 * summary of the same information, not a replacement mechanism.
 */
export interface ModelCapabilities {
  streaming: boolean;
  chat: boolean;
  structuredOutput: boolean;
  /** Native provider function-calling (OpenAI/Anthropic-style `tools`). Not yet built by any backend. */
  toolCalling: boolean;
  /**
   * Skill-based dispatch via `generateSkillCall()`/`runSkillLoop()` — built entirely
   * on `generate()` (a Zod discriminated union over registered skills), not on a
   * provider's native tool-calling API. Always true: every `ShapecraftModel` has
   * `generate()`, so every backend trivially supports it, same posture as
   * `structuredOutput` below.
   */
  skillDispatch: boolean;
}

export interface ShapecraftModel {
  id: string;
  guaranteeLevel: GuaranteeLevel;
  capabilities?: ModelCapabilities;
  generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T>;
  /**
   * Plain, unconstrained conversational turn (no schema/JSON mode imposed).
   * Required for `turnaround: true` — models without it throw when used that way.
   */
  chat?(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
  /**
   * Yields RAW text deltas only — no parsing/validation. `generateStream()`
   * (the core entry point) accumulates these and validates the assembled
   * buffer through the same pipeline as non-streaming `generate()`.
   * Absence ⇒ the core falls back to one-shot `generate()`.
   */
  generateStream?<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): AsyncIterable<string>;
}

/**
 * Pluggable JSON Schema structural validator (used only for `{ jsonSchema }`
 * inputs). Receives the same `(value, schema)` shape the built-in
 * `checkJsonSchema` does and must throw on failure. Omit to keep today's
 * built-in shallow validator — passing this option is the only way its
 * behavior changes.
 */
export type JsonSchemaValidator = (value: unknown, schema: Record<string, unknown>) => void;

/**
 * Content/meaning check that runs after structural validation passes — e.g.
 * "does this value actually appear in the source text" checks that no
 * type/shape check can catch. Throw (sync or async) to fail the stage; the
 * failure is wrapped in a `SchemaViolationError` so it retries exactly like a
 * structural failure does.
 */
export type SemanticValidator<T = unknown> = (value: T, context: { prompt: string }) => void | Promise<void>;

/**
 * Assigns a 0-1 confidence score to an already-validated value. Purely
 * informational unless `minConfidence` is also set, in which case a score
 * below the threshold fails the stage (wrapped in `SchemaViolationError`,
 * same retry treatment as structural/semantic failures).
 */
export type ConfidenceScorer<T = unknown> = (value: T, context: { prompt: string }) => number | Promise<number>;

/**
 * Transforms an already-validated value (e.g. normalization, trimming,
 * enrichment). Runs last, in array order, after every validation/scoring
 * stage has passed — a post-processor is never retried, it only reshapes a
 * value that already satisfied the schema.
 */
export type PostProcessor<T = unknown> = (value: T, context: { prompt: string; confidence?: number }) => T | Promise<T>;

export interface GenerateOptions {
  maxRetries?: number;
  systemPrompt?: string;
  temperature?: number;
  /**
   * Abort the in-flight call. Always enforced at the core level — the retry
   * loop stops waiting the instant it fires — regardless of whether the
   * backend itself reads `signal`. A backend that does gets the underlying
   * network request actually cancelled, not just abandoned.
   */
  signal?: AbortSignal;
  /**
   * Milliseconds before a single attempt is abandoned with a `TimeoutError`.
   * Enforced with the same core-level guarantee as `signal` above: generate()
   * never waits longer than this for one attempt, even against a backend
   * that ignores the passed-through signal.
   */
  timeoutMs?: number;
  /**
   * Override the built-in `{ jsonSchema }` structural check (e.g. swap in
   * AJV for `oneOf`/`format`/`pattern` support `checkJsonSchema` doesn't
   * have). Defaults to the bundled shallow validator when omitted — existing
   * callers see no behavior change.
   */
  jsonSchemaValidator?: JsonSchemaValidator;
  /** Optional stage after structural validation passes — see `SemanticValidator`. */
  semanticValidator?: SemanticValidator<unknown>;
  /** Optional stage after semantic validation passes — see `ConfidenceScorer`. */
  confidenceScorer?: ConfidenceScorer<unknown>;
  /**
   * Minimum acceptable `confidenceScorer` score (0-1). Ignored if no
   * `confidenceScorer` is set. A score below this fails the attempt and
   * triggers a retry, same as a structural/semantic validation failure.
   */
  minConfidence?: number;
  /** Optional final stage — see `PostProcessor`. Runs in array order. */
  postProcessors?: PostProcessor<unknown>[];
}

/** Best-effort call metadata — always present, but only `provider`/`model`/
 * `latencyMs` are guaranteed populated by the core today; the rest stay
 * `undefined` until a backend opts in to supplying them. */
export interface ResultMetadata {
  provider: string;
  model: string;
  latencyMs: number;
  tokens?: { input: number; output: number };
  finishReason?: string;
  requestId?: string;
  cost?: number;
}

export interface GenerateResult<T> {
  data: T;
  guaranteeLevel: GuaranteeLevel;
  attempts: number;
  metadata: ResultMetadata;
  /** Present only when a `confidenceScorer` was supplied — see `ConfidenceScorer`. */
  confidence?: number;
}

/** One independent unit of work for `generateBatch()`/`client.generateBatch()`. */
export interface BatchItem<T = unknown> {
  model: ShapecraftModel;
  schema: SchemaInput<T>;
  prompt: string;
  options?: GenerateOptions;
}

/**
 * Settled outcome for one `BatchItem` — mirrors `Promise.allSettled`'s shape
 * rather than throwing, so one failing item never loses the results of the
 * rest of the batch.
 */
export type BatchResult<T> = { status: "fulfilled"; value: GenerateResult<T> } | { status: "rejected"; reason: unknown };

export interface GenerateBatchOptions {
  /** Max number of items in flight at once. Omit (or <= 0) to run every item concurrently, uncapped. */
  concurrency?: number;
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

export class MaxTurnsExceededError extends Error {
  constructor(public readonly turns: number) {
    super(`Conversation did not complete after ${turns} turns`);
    this.name = "MaxTurnsExceededError";
  }
}

/**
 * A single attempt exceeded `timeoutMs`, or was cancelled via `signal`. NOT a
 * SchemaViolationError, so generate()'s retry loop does not swallow it — it
 * propagates to the caller immediately instead of silently retrying, since a
 * hung/slow backend retrying just as slowly rarely self-heals.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Generation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * A skill's own `handler` threw. Deliberately NOT a `SchemaViolationError` — the
 * dispatch (`{ skill, args }`) was structurally valid, the handler's own logic
 * failed. Never retried by anything in `generate()`'s pipeline, same non-retry
 * posture as `TimeoutError`: retrying a failing handler with the same args rarely
 * self-heals.
 */
export class SkillExecutionError extends Error {
  constructor(
    public readonly skill: string,
    public readonly cause: unknown
  ) {
    super(`Skill "${skill}" handler threw`);
    this.name = "SkillExecutionError";
  }
}

/**
 * `runSkillLoop()` hit `maxTurns` without a terminal skill running. Carries the
 * loop's `memory` so far, so a caller can persist it and call `runSkillLoop()`
 * again with a fresh `maxTurns` budget to continue instead of starting over.
 */
export class MaxSkillTurnsExceededError extends Error {
  constructor(
    public readonly turns: number,
    public readonly memory: SkillLoopMemory
  ) {
    super(`Skill loop did not complete after ${turns} turns`);
    this.name = "MaxSkillTurnsExceededError";
  }
}

/** Persisted, JSON-serializable conversation state for `turnaround` mode. */
export interface ConversationMemory {
  messages: ChatMessage[];
  status: "collecting" | "complete";
  turns: number;
}

export interface TurnaroundOptions {
  turnaround: true;
  /** Omit on the first turn; thread the previous result's `memory` back in afterwards. */
  memory?: ConversationMemory;
  /** Loop guard — throws MaxTurnsExceededError beyond this many turns. */
  maxTurns?: number;
}

export type TurnResult<T> =
  | { status: "collecting"; message: string; memory: ConversationMemory }
  | { status: "complete"; data: T; memory: ConversationMemory };

/**
 * A named, callable operation the model can choose via `generateSkillCall()`. The
 * dispatch schema `generateSkillCall()` builds is a `z.discriminatedUnion` over every
 * registered skill's `inputSchema` — v1 is deliberately Zod-only, since that's the
 * mechanism that makes dispatch work with zero new validation code (see
 * `skill-based-generation-plan.md` §2/§10).
 */
export interface Skill<TInput = unknown, TOutput = unknown> {
  name: string;
  /** Injected into the dispatch system prompt alongside the arg shape, so the model has more than the shape to pick from. */
  description?: string;
  inputSchema: z.ZodType<TInput>;
  handler: (args: TInput) => TOutput | Promise<TOutput>;
  /** Running this skill ends `runSkillLoop()` — its result becomes the loop's final answer. */
  terminal?: boolean;
}

/** What `generateSkillCall()` returns: which skill, and its (already-validated) arguments. */
export interface SkillCall<TArgs = unknown> {
  skill: string;
  args: TArgs;
}

export type SkillTurn = { call: SkillCall } & ({ result: unknown } | { error: unknown });

/** Persisted, JSON-serializable `runSkillLoop()` state — mirrors `ConversationMemory`. */
export interface SkillLoopMemory {
  turns: SkillTurn[];
  status: "running" | "complete";
  turnCount: number;
}

export interface RunSkillLoopOptions extends GenerateOptions {
  /** Loop guard — throws MaxSkillTurnsExceededError beyond this many turns. Default 20. */
  maxTurns?: number;
  /** Omit on the first call; thread a caught `MaxSkillTurnsExceededError.memory` back in to continue a loop that hit its turn budget. */
  memory?: SkillLoopMemory;
}

export type StreamEvent<T> =
  | { type: "attempt-start"; attempt: number }
  | { type: "delta"; text: string; attempt: number }
  /**
   * A top-level field just closed and passed its own sub-schema check —
   * `value` accumulates validated fields so far. Only emitted for schemas
   * shaped as a JSON object at the root (Zod object / jsonSchema with
   * `properties`); other schema types never emit this. Nested fields inside
   * a top-level field are not individually validated — the whole field's
   * value is checked once its own JSON closes.
   */
  | { type: "partial"; value: Partial<T>; attempt: number }
  | { type: "attempt-failed"; attempt: number; error: SchemaViolationError }
  | { type: "done"; result: GenerateResult<T> };

export interface StreamHandle<T> {
  /** Raw text deltas as they arrive (concatenation of all attempts — see README). */
  textStream: AsyncIterable<string>;
  /** Structured lifecycle events: deltas, attempt boundaries, retries, done. */
  events: AsyncIterable<StreamEvent<T>>;
  /** Resolves with the final validated result, or rejects with MaxRetriesExceededError. */
  result: Promise<GenerateResult<T>>;
}
