import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateStream } from "../src/core/stream.js";
import { buildStructuredPrompt } from "../src/core/schema.js";
import { anthropic } from "../src/backends/anthropic.js";
import { groq } from "../src/backends/groq.js";
import { ollama } from "../src/backends/ollama.js";
import { MaxRetriesExceededError } from "../src/types.js";
import type { SchemaInput, ShapecraftModel, StreamEvent } from "../src/types.js";
import { mockModel } from "./helpers/index.js";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasGroq = !!process.env.GROQ_API_KEY;
const hasOllama = !!process.env.OLLAMA_MODEL;
const ollamaModel = process.env.OLLAMA_MODEL ?? "nemotron-3-super:cloud";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

/** One scripted chunk array per attempt; each generateStream() call consumes the next. */
function mockStreamingModel(chunksPerAttempt: string[][]): ShapecraftModel {
  let attemptIndex = 0;
  return {
    id: "mock:stream",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      throw new Error("generate() should not be called directly in these tests");
    },
    async *generateStream<T>(): AsyncIterable<string> {
      const chunks = chunksPerAttempt[attemptIndex];
      attemptIndex++;
      if (!chunks) throw new Error("mock exhausted: no scripted chunks for this attempt");
      for (const chunk of chunks) yield chunk;
    },
  } as ShapecraftModel;
}

/** Mirrors a real backend: calls buildStructuredPrompt inside generateStream(), so a
 * bad XML template throws synchronously before any delta, exactly like production. */
function mockXmlAwareStreamingModel(): ShapecraftModel {
  return {
    id: "mock:xml-stream",
    guaranteeLevel: "constrained",
    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): Promise<T> {
      buildStructuredPrompt(prompt, schema, systemPrompt);
      return {} as T;
    },
    async *generateStream<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string): AsyncIterable<string> {
      buildStructuredPrompt(prompt, schema, systemPrompt); // throws synchronously for a bad template
      yield "<book></book>";
    },
  };
}

describe("generateStream", () => {
  it("streams deltas that accumulate to the full output, then resolves the validated result", async () => {
    const model = mockStreamingModel([['{"name":', '"Alice",', '"age":30}']]);
    const stream = generateStream(model, PersonSchema, "extract");

    const [textParts, events, result] = await Promise.all([collect(stream.textStream), collect(stream.events), stream.result]);

    expect(textParts.join("")).toBe('{"name":"Alice","age":30}');
    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("constrained");
    // Non-partial lifecycle events, in order (partial events are covered separately below).
    expect(events.filter((e) => e.type !== "partial").map((e) => e.type)).toEqual(["attempt-start", "delta", "delta", "delta", "done"]);
  });

  it("retries on validation failure: streams fresh on the next attempt and reports attempts correctly", async () => {
    const model = mockStreamingModel([
      ['{"name":"Alice"}'], // attempt 1: missing required "age" -> SchemaViolationError
      ['{"name":"Alice","age":30}'], // attempt 2: valid
    ]);
    const stream = generateStream(model, PersonSchema, "extract");

    const events = await collect(stream.events);
    const result = await stream.result;

    expect(result.attempts).toBe(2);
    expect(result.data).toEqual({ name: "Alice", age: 30 });

    const types = events.filter((e) => e.type !== "partial").map((e) => e.type);
    expect(types).toEqual(["attempt-start", "delta", "attempt-failed", "attempt-start", "delta", "done"]);

    const failedEvent = events.find((e): e is Extract<StreamEvent<unknown>, { type: "attempt-failed" }> => e.type === "attempt-failed");
    expect(failedEvent?.attempt).toBe(1);
  });

  it("exhausting all retries rejects result with MaxRetriesExceededError", async () => {
    const model = mockStreamingModel([['{"name":"Alice"}'], ['{"name":"Bob"}'], ['{"name":"Cara"}']]);
    const stream = generateStream(model, PersonSchema, "extract", { maxRetries: 3 });

    await expect(stream.result).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("falls back to one-shot generate() for a model without generateStream, emitting one delta", async () => {
    const model = mockModel({ name: "Alice", age: 30 });
    const stream = generateStream(model, PersonSchema, "extract");

    const [textParts, events, result] = await Promise.all([collect(stream.textStream), collect(stream.events), stream.result]);

    expect(result.data).toEqual({ name: "Alice", age: 30 });
    expect(result.attempts).toBe(1);
    expect(textParts).toHaveLength(1);
    expect(JSON.parse(textParts[0])).toEqual({ name: "Alice", age: 30 });
    expect(events.map((e) => e.type)).toEqual(["attempt-start", "delta", "done"]);
  });

  it("a bad XML template rejects before any delta is emitted — same fail-fast as generate()", async () => {
    const model = mockXmlAwareStreamingModel();
    const badSchema = { xml: { template: "<book>{garbled}</book>" } };
    const stream = generateStream(model, badSchema, "extract");

    const textPartsPromise = collect(stream.textStream);
    await expect(stream.result).rejects.toThrow(/Invalid placeholder/);
    expect(await textPartsPromise).toEqual([]);
  });

  it("a transport error mid-stream rejects immediately and is not retried", async () => {
    const model: ShapecraftModel = {
      id: "mock:transport-fail",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        throw new Error("should not be called");
      },
      async *generateStream<T>(): AsyncIterable<string> {
        yield '{"name":';
        throw new Error("network failure");
      },
    };

    const stream = generateStream(model, PersonSchema, "extract", { maxRetries: 3 });
    await expect(stream.result).rejects.toThrow("network failure");

    const events = await collect(stream.events);
    // Only one attempt-start — the transport error must not trigger a retry.
    expect(events.filter((e) => e.type === "attempt-start")).toHaveLength(1);
  });

  it("textStream and events observe the exact same delta text and ordering", async () => {
    const model = mockStreamingModel([['{"na', 'me":"Alice","age":30}']]);
    const stream = generateStream(model, PersonSchema, "extract");

    const [textParts, events] = await Promise.all([collect(stream.textStream), collect(stream.events)]);
    const deltaTextFromEvents = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text);

    expect(textParts).toEqual(deltaTextFromEvents);
  });

  it("emits a validated partial object the moment each top-level field closes, before the stream ends", async () => {
    const model = mockStreamingModel([['{"name":"Alice",', '"age":30}']]);
    const stream = generateStream(model, PersonSchema, "extract");

    const events = await collect(stream.events);
    const partials = events
      .filter((e): e is Extract<StreamEvent<{ name: string; age: number }>, { type: "partial" }> => e.type === "partial")
      .map((e) => e.value);

    // "name" closes after the first delta; "age" closes after the second —
    // each partial should already be validated (not raw/unchecked).
    expect(partials).toEqual([{ name: "Alice" }, { name: "Alice", age: 30 }]);

    // Partial events must arrive strictly before "done" — that's the whole point.
    const partialIndex = events.findIndex((e) => e.type === "partial");
    const doneIndex = events.findIndex((e) => e.type === "done");
    expect(partialIndex).toBeGreaterThanOrEqual(0);
    expect(partialIndex).toBeLessThan(doneIndex);
  });

  it("aborts an attempt early on the first invalid field instead of streaming the rest", async () => {
    let consumedChunks = 0;
    const chunks = ['{"name":"Alice","age":"not-a-number",', '"extra":"never consumed"}'];
    const model: ShapecraftModel = {
      id: "mock:early-abort",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        throw new Error("should not be called");
      },
      async *generateStream<T>(): AsyncIterable<string> {
        for (const chunk of chunks) {
          consumedChunks++;
          yield chunk;
        }
      },
    };

    const stream = generateStream(model, PersonSchema, "extract", { maxRetries: 1 });
    await expect(stream.result).rejects.toBeInstanceOf(MaxRetriesExceededError);

    // The second chunk (with "extra") should never have been pulled — the
    // scanner caught the bad "age" field inside the first chunk and aborted.
    expect(consumedChunks).toBe(1);
  });
});

describe("generateStream — Anthropic backend (real API)", () => {
  it.skipIf(!hasAnthropic)("streams real deltas that accumulate to a validated object", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const stream = generateStream(model, PersonSchema, "Extract: Jane Doe, 28 years old.");

    const textParts = await collect(stream.textStream);
    const result = await stream.result;

    expect(textParts.join("").length).toBeGreaterThan(0);
    expect(result.data.name).toBeTruthy();
    expect(result.data.age).toBeGreaterThan(0);
  });

  // Real token boundaries are irregular (unlike scripted mock chunks) — this is
  // the actual stress test for the incremental field-boundary scanner.
  it.skipIf(!hasAnthropic)("emits real incremental partial fields ahead of the final done event", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const stream = generateStream(model, PersonSchema, "Extract: Jane Doe, 28 years old.");

    const events = await collect(stream.events);
    const result = await stream.result;

    const partials = events.filter((e) => e.type === "partial");
    expect(partials.length).toBeGreaterThan(0);

    const doneIndex = events.findIndex((e) => e.type === "done");
    for (const p of partials) {
      expect(events.indexOf(p)).toBeLessThan(doneIndex);
    }

    // Every field that ever showed up in a partial must match the final result —
    // incremental validation must never disagree with the final whole-object check.
    const lastPartial = partials[partials.length - 1] as { value: Record<string, unknown> };
    for (const [key, value] of Object.entries(lastPartial.value)) {
      expect((result.data as Record<string, unknown>)[key]).toEqual(value);
    }
  });
});

describe("generateStream — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("streams real deltas that accumulate to a validated object", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const stream = generateStream(model, PersonSchema, "Extract: Jane Doe, 28 years old.");

    const textParts = await collect(stream.textStream);
    const result = await stream.result;

    expect(textParts.join("").length).toBeGreaterThan(0);
    expect(result.data.name).toBeTruthy();
    expect(result.data.age).toBeGreaterThan(0);
  });
});

describe("generateStream — Ollama backend (real API)", () => {
  it.skipIf(!hasOllama)("streams real NDJSON deltas that accumulate to a validated object", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const stream = generateStream(model, PersonSchema, "Extract: Jane Doe, 28 years old.");

    const textParts = await collect(stream.textStream);
    const result = await stream.result;

    expect(textParts.join("").length).toBeGreaterThan(0);
    expect(result.data.name).toBeTruthy();
    expect(result.data.age).toBeGreaterThan(0);
  });
});
