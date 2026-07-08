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

export interface ShapecraftModel {
  id: string;
  guaranteeLevel: GuaranteeLevel;
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
