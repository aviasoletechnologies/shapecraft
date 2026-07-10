import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tokenize } from "../src/core/streaming/tokenizer.js";
import { extractCompletedTopLevelFields, IncrementalParser } from "../src/core/streaming/incremental-parser.js";
import { validateFieldIfPossible } from "../src/core/streaming/validator.js";
import { StreamEmitter } from "../src/core/streaming/emitter.js";
import type { StreamEvent } from "../src/types.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function neverResolvingGuard(): Promise<never> {
  return new Promise<never>(() => {});
}

/** An async iterable that records whether return() was ever invoked. */
function trackedSource(chunks: string[]): { source: AsyncIterable<string>; returned: () => boolean } {
  let returned = false;
  let i = 0;
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<string>> {
          if (i >= chunks.length) return Promise.resolve({ value: undefined, done: true });
          return Promise.resolve({ value: chunks[i++]!, done: false });
        },
        return(): Promise<IteratorResult<string>> {
          returned = true;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
  return { source, returned: () => returned };
}

describe("tokenize (Tokenizer stage)", () => {
  it("yields every chunk from the source in order", async () => {
    const { source } = trackedSource(["a", "b", "c"]);
    const out = await collect(tokenize(source, neverResolvingGuard()));
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("propagates a guard rejection (timeout/abort) instead of waiting on a hung source", async () => {
    const hungSource: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}) }; // never resolves
      },
    };
    const guard = Promise.reject(new Error("timed out"));
    await expect(collect(tokenize(hungSource, guard))).rejects.toThrow("timed out");
  });

  it("calls return() on the underlying source when the consumer stops early", async () => {
    const { source, returned } = trackedSource(["a", "b", "c"]);
    const out: string[] = [];
    for await (const chunk of tokenize(source, neverResolvingGuard())) {
      out.push(chunk);
      if (chunk === "a") break;
    }
    expect(out).toEqual(["a"]);
    expect(returned()).toBe(true);
  });

  it("calls return() on the underlying source when the source itself errors mid-stream", async () => {
    let returned = false;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next(): Promise<IteratorResult<string>> {
            if (i === 0) {
              i++;
              return Promise.resolve({ value: "a", done: false });
            }
            return Promise.reject(new Error("network failure"));
          },
          return(): Promise<IteratorResult<string>> {
            returned = true;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
    await expect(collect(tokenize(source, neverResolvingGuard()))).rejects.toThrow("network failure");
    expect(returned).toBe(true);
  });
});

describe("extractCompletedTopLevelFields (pure scanner)", () => {
  it("returns {} for a buffer with no top-level object", () => {
    expect(extractCompletedTopLevelFields("not json at all")).toEqual({});
  });

  it("returns only fields that have fully closed", () => {
    expect(extractCompletedTopLevelFields('{"name":"Alice","age":3')).toEqual({ name: '"Alice"' });
  });
});

describe("IncrementalParser (Incremental Parser stage)", () => {
  it("surfaces each field exactly once across multiple feed() calls", () => {
    const parser = new IncrementalParser();
    const first = parser.feed('{"name":"Alice",');
    expect(first).toEqual([{ key: "name", value: "Alice" }]);

    const second = parser.feed('"age":30}');
    expect(second).toEqual([{ key: "age", value: 30 }]);

    // Feeding more of the same buffer again must not re-surface "name" or "age".
    const third = parser.feed("");
    expect(third).toEqual([]);
  });

  it("accumulates the full text across feeds via .text", () => {
    const parser = new IncrementalParser();
    parser.feed('{"a":1,');
    parser.feed('"b":2}');
    expect(parser.text).toBe('{"a":1,"b":2}');
  });

  it("is independent per instance - state does not leak across attempts", () => {
    const attempt1 = new IncrementalParser();
    attempt1.feed('{"name":"Alice"}');

    const attempt2 = new IncrementalParser();
    const fields = attempt2.feed('{"name":"Bob"}');
    expect(fields).toEqual([{ key: "name", value: "Bob" }]);
  });
});

describe("validateFieldIfPossible (Validator stage)", () => {
  const PersonSchema = z.object({ name: z.string(), age: z.number() });

  it("passes a valid field against a Zod schema", () => {
    expect(validateFieldIfPossible(PersonSchema, "age", 30)).toBeNull();
  });

  it("rejects an invalid field against a Zod schema", () => {
    expect(validateFieldIfPossible(PersonSchema, "age", "not-a-number")).toMatch(/age/);
  });

  it("passes a valid field against a jsonSchema properties entry", () => {
    const schema = { jsonSchema: { type: "object", properties: { age: { type: "number" } } } };
    expect(validateFieldIfPossible(schema, "age", 30)).toBeNull();
  });

  it("rejects an invalid field against a jsonSchema properties entry", () => {
    const schema = { jsonSchema: { type: "object", properties: { age: { type: "number" } } } };
    expect(validateFieldIfPossible(schema, "age", "thirty")).not.toBeNull();
  });

  it("never decomposes XML schemas - always returns null", () => {
    const schema = { xml: { template: "<book>{string}</book>" } };
    expect(validateFieldIfPossible(schema, "anything", "value")).toBeNull();
  });

  it("never decomposes pattern schemas - always returns null", () => {
    const schema = { pattern: /^\d+$/ };
    expect(validateFieldIfPossible(schema, "anything", "value")).toBeNull();
  });
});

describe("StreamEmitter (Emitter stage)", () => {
  it("fans a delta event out to both textStream and events, in the same order", async () => {
    const emitter = new StreamEmitter<{ name: string }>();
    emitter.emit({ type: "attempt-start", attempt: 1 });
    emitter.emit({ type: "delta", text: "hello", attempt: 1 });
    emitter.emit({ type: "delta", text: " world", attempt: 1 });
    emitter.finish();

    const [textParts, events] = await Promise.all([collect(emitter.textStream), collect(emitter.events)]);

    expect(textParts).toEqual(["hello", " world"]);
    expect(events.map((e) => e.type)).toEqual(["attempt-start", "delta", "delta"]);
  });

  it("non-delta events never reach textStream", async () => {
    const emitter = new StreamEmitter<{ name: string }>();
    const doneEvent: StreamEvent<{ name: string }> = {
      type: "done",
      result: { data: { name: "Alice" }, guaranteeLevel: "constrained", attempts: 1, metadata: { provider: "mock", model: "m", latencyMs: 1 } },
    };
    emitter.emit(doneEvent);
    emitter.finish();

    const textParts = await collect(emitter.textStream);
    expect(textParts).toEqual([]);
  });

  it("finish() ends both channels so pending consumers resolve with done", async () => {
    const emitter = new StreamEmitter<{ name: string }>();
    const textPromise = collect(emitter.textStream);
    const eventsPromise = collect(emitter.events);
    emitter.finish();

    await expect(textPromise).resolves.toEqual([]);
    await expect(eventsPromise).resolves.toEqual([]);
  });
});
