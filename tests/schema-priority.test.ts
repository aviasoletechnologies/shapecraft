/**
 * Schema priority tests — what happens when two conflicting schemas are provided:
 *   1. schema argument  → drives both buildStructuredPrompt injection AND validateOutput
 *   2. systemPrompt     → user-supplied context, also injected into system prompt
 *
 * The schema argument ALWAYS wins for validation — systemPrompt schema is just text the LLM sees.
 * These tests prove that and show where the conflict surfaces per backend.
 */

import { describe, it, expect, vi } from "vitest";
import { generate } from "../src/core/generate.js";
import { buildStructuredPrompt } from "../src/core/schema.js";
import { anthropic } from "../src/backends/anthropic.js";
import { openai } from "../src/backends/openai.js";
import { groq } from "../src/backends/groq.js";
import { ollama } from "../src/backends/ollama.js";
import { MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel } from "../src/types.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

// Schema A — passed as the schema argument
const SchemaA = {
  type: "object",
  required: ["id", "score"],
  properties: {
    id:    { type: "string" },
    score: { type: "number" },
  },
} as const;

// Schema B — mentioned only in systemPrompt (the "conflicting" one)
const SchemaBDescription = `
Return JSON with this shape:
{
  "username": "<string>",
  "level": <number>
}
`;

// ─── buildStructuredPrompt inspection ────────────────────────────────────────

describe("Schema priority — system prompt composition", () => {
  it("schema arg schema appears in system prompt even when systemPrompt is provided", () => {
    const { system } = buildStructuredPrompt("do something", { jsonSchema: SchemaA }, "You are helpful.");
    // Schema A fields injected by shapecraft
    expect(system).toContain('"id"');
    expect(system).toContain('"score"');
    // User system prompt preserved
    expect(system).toContain("You are helpful.");
  });

  it("system prompt with conflicting schema B — both appear in the final system string", () => {
    const { system } = buildStructuredPrompt(
      "do something",
      { jsonSchema: SchemaA },
      `You are helpful. ${SchemaBDescription}`
    );
    // Both schemas visible in system prompt — LLM sees a conflict
    expect(system).toContain('"id"');    // from SchemaA (schema arg)
    expect(system).toContain('"score"'); // from SchemaA (schema arg)
    expect(system).toContain("username"); // from SchemaB (systemPrompt)
    expect(system).toContain("level");   // from SchemaB (systemPrompt)
  });

  it("schema arg instruction always appended AFTER user system prompt", () => {
    const { system } = buildStructuredPrompt(
      "do something",
      { jsonSchema: SchemaA },
      "You are helpful."
    );
    const userPromptPos  = system.indexOf("You are helpful.");
    const schemaInjectPos = system.indexOf("Respond with valid JSON");
    // Schema injection comes after user system prompt
    expect(schemaInjectPos).toBeGreaterThan(userPromptPos);
  });
});

// ─── Validation priority — schema arg always enforced ────────────────────────

describe("Schema priority — validation always enforces schema argument", () => {
  it("model returns SchemaA-shaped data → passes (schema arg wins)", async () => {
    // Model follows SchemaA (the correct one)
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        return { id: "abc", score: 42 } as T;
      },
    };

    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      "extract data",
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );

    expect(result.data).toEqual({ id: "abc", score: 42 });
    expect(result.attempts).toBe(1);
  });

  it("model returns SchemaB-shaped data (follows systemPrompt) → fails validation", async () => {
    // Model followed systemPrompt's schema B instead of schema arg
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        return { username: "alice", level: 5 } as T;
      },
    };

    await expect(
      generate(
        model,
        { jsonSchema: SchemaA },
        "extract data",
        { systemPrompt: `You are helpful. ${SchemaBDescription}`, maxRetries: 1 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("model returns SchemaB-shaped data — retries exhaust before passing", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        calls++;
        // Always returns SchemaB shape — never satisfies SchemaA validation
        return { username: "alice", level: calls } as T;
      },
    };

    await expect(
      generate(
        model,
        { jsonSchema: SchemaA },
        "extract data",
        { systemPrompt: `You are helpful. ${SchemaBDescription}`, maxRetries: 3 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);

    expect(calls).toBe(3); // all 3 retries burned
  });

  it("model returns partial SchemaA data missing required field → fails validation", async () => {
    // Model returned only 'id', missing required 'score'
    const model: ShapecraftModel = {
      id: "mock:test",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        return { id: "abc" } as T; // score missing
      },
    };

    await expect(
      generate(
        model,
        { jsonSchema: SchemaA },
        "extract data",
        { maxRetries: 1 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});

// ─── Per-backend — real API calls, skipped when key not in .env ──────────────

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAI    = false; // OpenAI quota exceeded — re-enable when credits added
const hasGroq      = !!process.env.GROQ_API_KEY;

describe("Schema priority — Anthropic backend (real API)", () => {
  it.skipIf(!hasAnthropic)("schema arg enforced: returns SchemaA-shaped data", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return an object with id="abc" and score=42.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
  }, 30_000);

  it.skipIf(!hasAnthropic)("schema arg enforced: SchemaB prompt still validated against SchemaA — retries and passes", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    // Prompt mentions SchemaB shape but schema arg is SchemaA — model should follow SchemaA
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return a JSON object with username="alice" and level=5.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    // Validation enforces SchemaA — result must have id+score regardless of prompt wording
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    console.log("[anthropic real] schema priority result:", result.data, "attempts:", result.attempts);
  }, 30_000);
});

describe("Schema priority — OpenAI backend (real API)", () => {
  it.skipIf(!hasOpenAI)("schema arg enforced: returns SchemaA-shaped data", async () => {
    const model = openai({ model: "gpt-4o-mini" });
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return an object with id="abc" and score=42.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    console.log("[openai real] schema priority result:", result.data, "attempts:", result.attempts);
  }, 30_000);

  it.skipIf(!hasOpenAI)("schema arg enforced: SchemaB prompt still validated against SchemaA", async () => {
    const model = openai({ model: "gpt-4o-mini" });
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return a JSON object with username="bob" and level=3.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    console.log("[openai real] conflicting prompt result:", result.data, "attempts:", result.attempts);
  }, 30_000);
});

describe("Schema priority — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("schema arg enforced: returns SchemaA-shaped data", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return an object with id="abc" and score=42.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    console.log("[groq real] schema priority result:", result.data, "attempts:", result.attempts);
  }, 30_000);

  it.skipIf(!hasGroq)("conflict: Groq follows user prompt over schema — exhausts retries", async () => {
    // Groq/llama prioritises the user message over the schema injection in the system prompt.
    // When they conflict, the model keeps returning SchemaB-shaped output, failing SchemaA
    // validation every time — unlike Anthropic which remaps field names to match the schema.
    const model = groq({ model: "llama-3.3-70b-versatile" });
    await expect(
      generate(
        model,
        { jsonSchema: SchemaA },
        'Return a JSON object with username="carol" and level=8.',
        { systemPrompt: `You are helpful. ${SchemaBDescription}`, maxRetries: 3 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
    console.log("[groq real] conflict: MaxRetriesExceededError as expected — Groq followed user prompt, not schema arg");
  }, 30_000);
});

describe("Schema priority — Ollama backend (real API)", () => {
  const hasOllama = true;
  const ollamaModel = process.env.OLLAMA_MODEL ?? "nemotron-3-super:cloud";

  it.skipIf(!hasOllama)("schema arg enforced: returns SchemaA-shaped data", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return an object with id="abc" and score=42.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    console.log("[ollama real] schema priority result:", result.data, "attempts:", result.attempts);
  }, 120_000);

  it.skipIf(!hasOllama)("schema arg enforced: SchemaB prompt still produces SchemaA-shaped data (constrained decoding)", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    // Prompt explicitly asks for SchemaB shape — Ollama constrained decoding should ignore it
    const result = await generate(
      model,
      { jsonSchema: SchemaA },
      'Return a JSON object with username="dave" and level=2.',
      { systemPrompt: `You are helpful. ${SchemaBDescription}` }
    );
    // SchemaA must win — id and score required, username/level must not appear
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
    expect((result.data as any).username).toBeUndefined();
    expect((result.data as any).level).toBeUndefined();
    console.log("[ollama real] conflicting prompt result:", result.data, "attempts:", result.attempts);
  }, 120_000);
});

describe("Schema priority — Ollama backend", () => {
  it("schema arg enforced: SchemaA-shaped response passes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ id: "x4", score: 33 }) } }),
    }));
    const model = ollama({ model: "llama3" });
    const result = await generate(model, { jsonSchema: SchemaA }, "extract", {
      systemPrompt: `You are helpful. ${SchemaBDescription}`,
    });
    expect(result.data).toMatchObject({ id: expect.any(String), score: expect.any(Number) });
  });

  it("schema arg enforced: SchemaB-shaped response fails validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ username: "dave", level: 2 }) } }),
    }));
    const model = ollama({ model: "llama3" });
    await expect(
      generate(model, { jsonSchema: SchemaA }, "extract", {
        systemPrompt: `You are helpful. ${SchemaBDescription}`,
        maxRetries: 1,
      })
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});
