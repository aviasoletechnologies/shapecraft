import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate.js";
import { generateStream } from "../src/core/stream.js";
import { matchesGbnf, parseGbnf, buildGbnfSystemPrompt } from "../src/core/gbnf.js";
import { groq } from "../src/backends/groq.js";
import { fireworks } from "../src/backends/fireworks.js";
import { MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel, StreamEvent } from "../src/types.js";
import { mockModel } from "./helpers/index.js";

const hasGroq = !!process.env.GROQ_API_KEY;
const hasFireworks = !!process.env.FIREWORKS_API_KEY;

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

// ─── The interpreter: parser + matcher ────────────────────────────────────────

describe("GBNF interpreter — matchesGbnf", () => {
  it("matches an exact string literal", () => {
    const g = `root ::= "hello"`;
    expect(matchesGbnf(g, "hello")).toBe(true);
    expect(matchesGbnf(g, "hi")).toBe(false);
    expect(matchesGbnf(g, "hello!")).toBe(false); // must consume whole input
  });

  it("handles alternation", () => {
    const g = `root ::= "cat" | "dog"`;
    expect(matchesGbnf(g, "cat")).toBe(true);
    expect(matchesGbnf(g, "dog")).toBe(true);
    expect(matchesGbnf(g, "bird")).toBe(false);
  });

  it("handles sequences and character classes with ranges", () => {
    const g = `root ::= [0-9] [0-9]`;
    expect(matchesGbnf(g, "42")).toBe(true);
    expect(matchesGbnf(g, "4")).toBe(false);
    expect(matchesGbnf(g, "4a")).toBe(false);
  });

  it("handles * + ? repetition", () => {
    expect(matchesGbnf(`root ::= "a"*`, "")).toBe(true);
    expect(matchesGbnf(`root ::= "a"*`, "aaa")).toBe(true);
    expect(matchesGbnf(`root ::= "a"+`, "")).toBe(false);
    expect(matchesGbnf(`root ::= "a"+`, "a")).toBe(true);
    expect(matchesGbnf(`root ::= "a"? "b"`, "b")).toBe(true);
    expect(matchesGbnf(`root ::= "a"? "b"`, "ab")).toBe(true);
    expect(matchesGbnf(`root ::= "a"? "b"`, "aab")).toBe(false);
  });

  it("handles bounded {m,n} repetition", () => {
    const g = `root ::= "a"{2,4}`;
    expect(matchesGbnf(g, "a")).toBe(false);
    expect(matchesGbnf(g, "aa")).toBe(true);
    expect(matchesGbnf(g, "aaaa")).toBe(true);
    expect(matchesGbnf(g, "aaaaa")).toBe(false);
    expect(matchesGbnf(`root ::= "a"{3}`, "aaa")).toBe(true);
    expect(matchesGbnf(`root ::= "a"{2,}`, "aaaaa")).toBe(true);
  });

  it("backtracks through greedy repetition", () => {
    // requires giving back an 'a' consumed by "a"* so the trailing "a" can match
    const g = `root ::= "a"* "a"`;
    expect(matchesGbnf(g, "")).toBe(false);
    expect(matchesGbnf(g, "a")).toBe(true);
    expect(matchesGbnf(g, "aaa")).toBe(true);
  });

  it("handles negated character classes", () => {
    const g = `root ::= [^0-9]+`;
    expect(matchesGbnf(g, "abc")).toBe(true);
    expect(matchesGbnf(g, "ab1")).toBe(false);
  });

  it("handles rule references and a realistic date grammar", () => {
    const g = `
      root  ::= year "-" month "-" day
      year  ::= [0-9]{4}
      month ::= [0-9]{2}
      day   ::= [0-9]{2}
    `;
    expect(matchesGbnf(g, "2026-07-06")).toBe(true);
    expect(matchesGbnf(g, "2026-7-6")).toBe(false);
    expect(matchesGbnf(g, "not-a-date")).toBe(false);
  });

  it("handles escapes and quoted content", () => {
    const g = `root ::= "\\"" [a-z]+ "\\""`;
    expect(matchesGbnf(g, `"abc"`)).toBe(true);
    expect(matchesGbnf(g, `abc`)).toBe(false);
  });

  it("strips # line comments", () => {
    const g = `
      # a yes/no grammar
      root ::= "yes" | "no"  # the two options
    `;
    expect(matchesGbnf(g, "yes")).toBe(true);
    expect(matchesGbnf(g, "maybe")).toBe(false);
  });

  it("matches a small nested JSON-object grammar", () => {
    const g = `
      root   ::= "{" "\\"n\\":" number "}"
      number ::= "-"? [0-9]+
    `;
    expect(matchesGbnf(g, `{"n":42}`)).toBe(true);
    expect(matchesGbnf(g, `{"n":-7}`)).toBe(true);
    expect(matchesGbnf(g, `{"n":}`)).toBe(false);
  });

  it("does not false-negative on the same rule referenced twice at one position", () => {
    // both `a` can match empty — "" must be accepted (regression guard for the
    // left-recursion detector being too aggressive)
    const g = `
      root ::= a a
      a    ::= "x"?
    `;
    expect(matchesGbnf(g, "")).toBe(true);
    expect(matchesGbnf(g, "x")).toBe(true);
    expect(matchesGbnf(g, "xx")).toBe(true);
    expect(matchesGbnf(g, "xxx")).toBe(false);
  });

  it("does not hang on a left-recursive grammar", () => {
    // left recursion is not fully supported, but must terminate (never hang)
    const g = `root ::= root "a" | "a"`;
    expect(matchesGbnf(g, "a")).toBe(true);
    expect(typeof matchesGbnf(g, "aaaa")).toBe("boolean");
  });
});

describe("GBNF interpreter — adversarial / pathological grammars (stress)", () => {
  it("does not exhibit catastrophic backtracking on the classic (a a?)* b trap", () => {
    // The canonical pattern that blows up naive backtracking regex engines:
    // ambiguous nested repetition matched against a long string with no valid
    // terminator. The set-returning matcher dedupes by *position reached*, not
    // by path taken, so this stays near-linear instead of exponential.
    const g = `root ::= ("a" "a"?)* "b"`;
    const t0 = Date.now();
    expect(matchesGbnf(g, "a".repeat(200))).toBe(false); // no trailing "b" -> no match
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("does not exhibit catastrophic backtracking on ambiguous variable-length alternation", () => {
    const g = `root ::= item* "X"\nitem ::= [0-9] | [0-9][0-9] | [0-9][0-9][0-9]`;
    const t0 = Date.now();
    expect(matchesGbnf(g, "1".repeat(20_000))).toBe(false); // no trailing "X"
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("matches correctly against a very large input for a simple grammar", () => {
    expect(matchesGbnf(`root ::= [a-z]+`, "a".repeat(200_000))).toBe(true);
    expect(matchesGbnf(`root ::= [a-z]+`, "a".repeat(200_000) + "1")).toBe(false);
  });

  it("handles a large bounded-repetition count correctly at both edges", () => {
    const g = `root ::= "a"{1,5000}`;
    expect(matchesGbnf(g, "a".repeat(5000))).toBe(true);
    expect(matchesGbnf(g, "a".repeat(5001))).toBe(false);
  });

  it("the step-budget guard trips on a sufficiently extreme grammar, in bounded time, without hanging", () => {
    // 26-way variable-length ambiguous alternation over a 300k-char input with
    // a terminator that never appears — genuinely explores enough (position,
    // rule) combinations to exceed STEP_BUDGET. Proves the safety valve works
    // (throws a clear message, doesn't hang) rather than merely being untested.
    const opts = Array.from({ length: 26 }, (_, i) => `"${"x".repeat((i % 5) + 1)}"`).join(" | ");
    const g = `root ::= item* "END_MARKER_THAT_NEVER_APPEARS"\nitem ::= ${opts}`;
    const t0 = Date.now();
    expect(() => matchesGbnf(g, "x".repeat(300_000))).toThrow(/step budget/i);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("right-recursive rule REFERENCES (not */+) have a real depth limit — throws a clear, actionable error instead of a raw stack overflow", () => {
    // Unlike `*`/`+` (iterative BFS, no recursion), a rule reference recurses
    // through the JS call stack once per repetition. Empirically this breaks
    // somewhere between depth 900-1000 on this engine/build. Below the limit
    // it must still work correctly.
    const g = `root ::= "a" root | ""`;
    expect(matchesGbnf(g, "a".repeat(500))).toBe(true);
    expect(() => matchesGbnf(g, "a".repeat(5000))).toThrow(/recursion is too deep/i);
  });

  it("right-recursion depth limit does not affect the equivalent */+ formulation", () => {
    // The documented workaround actually works: the same "many a's" language
    // expressed with `+` instead of recursive references has no depth limit.
    expect(matchesGbnf(`root ::= "a"+`, "a".repeat(50_000))).toBe(true);
  });
});

describe("GBNF interpreter — malformed grammars throw before any model call", () => {
  it("throws on missing root rule", () => {
    expect(() => parseGbnf(`start ::= "x"`)).toThrow(/no .root. rule/i);
  });

  it("throws on unbalanced group", () => {
    expect(() => parseGbnf(`root ::= ( "a"`)).toThrow(/Invalid GBNF grammar/);
  });

  it("throws on unterminated string literal", () => {
    expect(() => parseGbnf(`root ::= "abc`)).toThrow(/Invalid GBNF grammar/);
  });

  it("buildGbnfSystemPrompt validates the grammar and embeds it", () => {
    expect(() => buildGbnfSystemPrompt({ gbnf: `root ::= (` })).toThrow(/Invalid GBNF grammar/);
    const prompt = buildGbnfSystemPrompt({ gbnf: `root ::= "yes" | "no"` });
    expect(prompt).toContain("GBNF grammar");
    expect(prompt).toContain(`root ::= "yes" | "no"`);
  });
});

// ─── Dispatch integration through generate() ──────────────────────────────────

describe("GBNF input — dispatch through generate()", () => {
  const dateGrammar = `
    root  ::= [0-9]{4} "-" [0-9]{2} "-" [0-9]{2}
  `;

  it("returns the raw conforming string", async () => {
    const model = mockModel("2026-07-06");
    const result = await generate(model, { gbnf: dateGrammar }, "today's date");
    expect(result.data).toBe("2026-07-06");
    expect(result.attempts).toBe(1);
  });

  it("returns output as a string, never JSON-parsed", async () => {
    const model = mockModel("42");
    const result = await generate(model, { gbnf: `root ::= [0-9]+` }, "a number");
    expect(result.data).toBe("42"); // string "42", not number 42
    expect(typeof result.data).toBe("string");
  });

  it("retries and throws MaxRetriesExceededError on non-conforming output", async () => {
    const model = mockModel("not-a-date");
    await expect(
      generate(model, { gbnf: dateGrammar }, "today's date", { maxRetries: 2 })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("propagates a malformed-grammar error without retrying", async () => {
    // A grammar bug is a programmer error — it should surface immediately as a
    // plain Error, not be retried into MaxRetriesExceededError.
    const model = mockModel("anything");
    await expect(
      generate(model, { gbnf: `root ::= (` }, "x", { maxRetries: 3 })
    ).rejects.toThrow(/Invalid GBNF grammar/);
  });
});

// ─── Streaming: delta/done only, never partial ────────────────────────────────

describe("GBNF input — streaming emits no per-field partials", () => {
  function mockStreamingModel(chunks: string[]): ShapecraftModel {
    return {
      id: "mock:gbnf-stream",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        throw new Error("generate() should not be called in these tests");
      },
      async *generateStream(): AsyncIterable<string> {
        for (const c of chunks) yield c;
      },
    } as ShapecraftModel;
  }

  it("emits delta/done but no partial, even for a JSON-shaped grammar", async () => {
    // Grammar produces a JSON object — proves the incremental field scanner is
    // suppressed for gbnf (it would otherwise emit misleading `partial` events).
    const g = `
      root   ::= "{" "\\"n\\":" number "}"
      number ::= [0-9]+
    `;
    const model = mockStreamingModel(['{"n":', "4", "2}"]);
    const stream = generateStream(model, { gbnf: g }, "make an object");

    const [events, result] = await Promise.all([
      collect(stream.events),
      stream.result,
    ]);

    const types = events.map((e: StreamEvent<unknown>) => e.type);
    expect(types).toContain("delta");
    expect(types).toContain("done");
    expect(types).not.toContain("partial");
    expect(result.data).toBe('{"n":42}');
  });
});

// ─── Real backend: Groq (skip-gated) ──────────────────────────────────────────
// Regression guard: groq() must NOT force response_format: json_object for a
// gbnf input — the grammar's output is a free-form string, and Groq's API
// rejects json_object mode outright when the prompt doesn't contain the word
// "json" (a 400, not a validation failure). Caught by exercising the real API
// through the test-repo's /gbnf endpoint; XML already had this guard, gbnf
// (added on both generate() and generateStream()) initially didn't.
describe("GBNF input — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("does not force json_object mode, so a plain-string grammar succeeds", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      { gbnf: `root ::= "positive" | "negative" | "neutral"` },
      "Classify the sentiment: 'This is the best purchase I've made all year!'"
    );
    expect(["positive", "negative", "neutral"]).toContain(result.data);
  }, 30_000);

  it.skipIf(!hasGroq)("streaming does not force json_object mode either", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const stream = generateStream(model, { gbnf: `root ::= "positive" | "negative" | "neutral"` }, "Classify: 'I love it!'");
    const result = await stream.result;
    expect(["positive", "negative", "neutral"]).toContain(result.data);
  }, 30_000);
});

// ─── Real backend: Fireworks AI (skip-gated) ──────────────────────────────────
// Fireworks' grammar mode (response_format: { type: "grammar", grammar }) is a
// genuine token-level constraint, not a prompted-and-checked best-effort string
// like every other cloud backend's gbnf path - this is the actual reason a
// dedicated fireworks() backend exists instead of pointing openai() at
// Fireworks' base URL. https://docs.fireworks.ai/structured-responses/structured-output-grammar-based
describe("GBNF input — Fireworks backend (real API)", () => {
  it.skipIf(!hasFireworks)("produces grammar-conforming output via native grammar mode", async () => {
    const model = fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" });
    const result = await generate(
      model,
      { gbnf: `root ::= "positive" | "negative" | "neutral"` },
      "Classify the sentiment: 'This is the best purchase I've made all year!'"
    );
    expect(["positive", "negative", "neutral"]).toContain(result.data);
  }, 30_000);

  it.skipIf(!hasFireworks)("streaming works the same way through grammar mode", async () => {
    const model = fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" });
    const stream = generateStream(model, { gbnf: `root ::= "positive" | "negative" | "neutral"` }, "Classify: 'I love it!'");
    const result = await stream.result;
    expect(["positive", "negative", "neutral"]).toContain(result.data);
  }, 30_000);
});

// ─── Real backend: llamaCpp (skip-gated on a local model) ─────────────────────

const MODEL_PATH = process.env.LLAMACPP_MODEL_PATH;
const describeLlama = MODEL_PATH ? describe : describe.skip;

describeLlama("GBNF input — llamaCpp() token-level constraint", () => {
  it("produces grammar-conforming output with a constrained guarantee", async () => {
    const { llamaCpp } = await import("../src/backends/llamaCpp.js");
    const model = llamaCpp({ modelPath: MODEL_PATH! });
    const grammar = `root ::= "positive" | "negative" | "neutral"`;
    const result = await generate(
      model,
      { gbnf: grammar },
      "Classify the sentiment of: 'I absolutely love this product!'"
    );
    expect(["positive", "negative", "neutral"]).toContain(result.data);
    expect(result.guaranteeLevel).toBe("constrained");
  }, 120_000);
});
