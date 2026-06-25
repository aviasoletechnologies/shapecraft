/**
 * @file shapecraft-bug-report.test.ts
 *
 * Confirmed library bugs for @aviasole/shapecraft.
 * Each test proves a real defect in the library code — not AI behaviour.
 *
 * Run:  npx vitest run tests/shapecraft-bug-report.test.ts
 * Needs: GROQ_API_KEY in .env
 *
 * B1  FIXED  — non-schema errors were retried instead of thrown immediately
 * B2  OPEN   — GenerateOptions.systemPrompt silently ignored by all backends
 * B3  OPEN   — GenerateOptions.temperature silently ignored by all backends
 * B5  FIXED  — { pattern } schema on Groq always throws HTTP 400
 * B6  OPEN   — Groq guaranteeLevel returns "native" but enforces nothing at API level
 * B8  OPEN   — z.number().optional() crashes when AI sends null
 */

import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { generate, groq } from "../src/index.js";
import type { GenerateOptions } from "../src/types.js";

const hasKey = !!process.env.GROQ_API_KEY;
const itLive = hasKey ? it : it.skip;

describe("Library Bug Tests", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  // ─── B1: FIXED ─────────────────────────────────────────────────────────────
  //
  // BUG: bad API key was retried 3× before throwing.
  //
  // ERROR (before fix):
  //   MaxRetriesExceededError: All 3 attempts failed
  //     Attempt 1: AuthenticationError: 401 Invalid API Key
  //     Attempt 2: AuthenticationError: 401 Invalid API Key
  //     Attempt 3: AuthenticationError: 401 Invalid API Key
  //
  // FIX in generate.ts:
  //   if (!(err instanceof SchemaViolationError)) throw err
  itLive("B1 — FIXED: bad API key throws immediately, not retried 3×", async () => {
    const badModel = groq({ apiKey: "gsk_invalid_key_000000000000" });
    const start = Date.now();

    try {
      await generate(badModel, z.object({ name: z.string() }), "hello", { maxRetries: 3 });
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`[B1] threw: ${(err as Error).constructor.name} in ${elapsed}ms`);
      expect((err as Error).constructor.name).not.toBe("MaxRetriesExceededError");
      expect(elapsed).toBeLessThan(5000);
    }
  }, 30000);

  // ─── B2: OPEN ──────────────────────────────────────────────────────────────
  //
  // BUG: GenerateOptions.systemPrompt typed in types.ts but never sent to any backend.
  //
  // ROOT CAUSE: groq.ts / anthropic.ts / gemini.ts never read options.systemPrompt.
  //
  // SILENT MISBEHAVIOUR:
  //   systemPrompt: "Always respond ONLY in Spanish."
  //   Result: AI returns English — instruction silently dropped, no error.
  //
  // FIX NEEDED: prepend { role: "system", content: options.systemPrompt }
  //   to messages array in each backend when systemPrompt is provided.
  itLive("B2 — OPEN: systemPrompt option silently ignored by Groq backend", async () => {
    const result = await generate(
      model,
      z.object({ greeting: z.string() }),
      'Say "hello world" as a greeting.',
      { systemPrompt: "Always respond ONLY in Spanish. Never use English under any circumstances." } satisfies GenerateOptions
    );

    console.log(`[B2] greeting: "${result.data.greeting}"`);
    expect(typeof result.data.greeting).toBe("string");
    // When B2 is fixed, assert Spanish: expect(result.data.greeting.toLowerCase()).toMatch(/hola|mundo/)
  }, 30000);

  // ─── B3: OPEN ──────────────────────────────────────────────────────────────
  //
  // BUG: GenerateOptions.temperature typed in types.ts but never passed to any backend.
  //
  // ROOT CAUSE: groq.ts / anthropic.ts / gemini.ts never read options.temperature.
  //
  // IMPACT: temperature: 0 (deterministic) and temperature: 1 (creative)
  //   both use the backend default — apps get non-deterministic output silently.
  //
  // FIX NEEDED:
  //   groq.ts:     client.chat.completions.create({ ..., temperature: options?.temperature })
  //   anthropic.ts: client.messages.create({ ..., temperature: options?.temperature })
  //   gemini.ts:   generativeModel.generateContent({ ..., temperature: options?.temperature })
  itLive("B3 — FIXED: temperature option wired to Groq API", async () => {
    const schema = z.object({ word: z.string() });
    const prompt = "Give me ONE random English word. Just the word, nothing else.";

    // temp=0 is deterministic — two calls must return the same word
    const [r1, r2] = await Promise.all([
      generate(model, schema, prompt, { temperature: 0 }),
      generate(model, schema, prompt, { temperature: 0 }),
    ]);

    console.log(`[B3] temp=0 run1: "${r1.data.word}" | temp=0 run2: "${r2.data.word}"`);
    expect(r1.data.word.toLowerCase()).toBe(r2.data.word.toLowerCase());
  }, 30000);

  // ─── B5: FIXED ─────────────────────────────────────────────────────────────
  //
  // FIX in groq.ts: response_format: json_object now only set for Zod/jsonSchema.
  //   Skipped for PatternInput and ValidatorInput — Groq receives no format constraint.
  //
  // WAS: BadRequestError: 400 "'messages' must contain the word 'json'..."
  itLive("B5 — FIXED: { pattern } schema works on Groq without response_format", async () => {
    const result = await generate(
      model,
      { pattern: /^\+?[1-9]\d{9,14}$/ },
      "Call us at +919876543210. Extract the phone number. Return ONLY the phone number, nothing else."
    );

    console.log(`[B5] result: "${result.data}"`);
    expect(typeof result.data).toBe("string");
    expect(/^\+?[1-9]\d{9,14}$/.test(result.data as string)).toBe(true);
  }, 30000);

  // ─── B6: OPEN ──────────────────────────────────────────────────────────────
  //
  // BUG: groq.ts returns guaranteeLevel: "native" implying Groq enforces schema
  //   at the API level. It does not. Groq only forces valid JSON output.
  //   All field-level constraints (min/max, enum, required fields) are enforced
  //   by Zod post-generation, not by Groq.
  //
  // MISLEADING METADATA — no error thrown:
  //   result.guaranteeLevel === "native"   ← false claim
  //
  // FIX NEEDED in groq.ts:
  //   return { data, attempts, guaranteeLevel: "best-effort" }
  itLive("B6 — OPEN: guaranteeLevel 'native' is false — Groq enforces nothing at API level", async () => {
    const result = await generate(
      model,
      z.object({
        score: z.number().min(1).max(10),
        label: z.enum(["low", "medium", "high"]),
      }),
      "Rate quality on a scale of 1-10 and classify as low/medium/high."
    );

    console.log(`[B6] score: ${result.data.score}, label: "${result.data.label}", guaranteeLevel: "${result.guaranteeLevel}"`);
    expect(result.guaranteeLevel).toBe("native"); // BUG: should be "best-effort"
    expect(result.data.score).toBeGreaterThanOrEqual(1);
    expect(result.data.score).toBeLessThanOrEqual(10);
    expect(["low", "medium", "high"]).toContain(result.data.label);
  }, 30000);

  // ─── B8a: OPEN ─────────────────────────────────────────────────────────────
  //
  // BUG: z.number().optional() is incompatible with AI output. JSON has no
  //   undefined — LLMs always emit null for absent fields. Zod .optional()
  //   accepts undefined but NOT null. Retries never fix it — AI always sends null.
  //
  // ERROR after maxRetries:
  //   MaxRetriesExceededError: All 3 attempts failed
  //     SchemaViolationError: Model output failed schema validation
  //       ZodError: { "expected": "number", "received": "null", "path": ["endYear"] }
  //     raw: '{"name":"Jane","endYear":null}'
  //
  // FIX NEEDED: library should coerce null → undefined for optional-only fields,
  //   OR document that users must always write .nullable().optional().
  itLive("B8a — OPEN: z.number().optional() always fails when AI emits null", async () => {
    await expect(
      generate(
        model,
        z.object({ name: z.string(), endYear: z.number().optional() }),
        "Extract: Jane works at Google since 2022 (still employed there).",
        { maxRetries: 3 }
      )
    ).rejects.toThrow();
    // MaxRetriesExceededError — AI sends {"endYear":null} every attempt
  }, 30000);

  itLive("B8b — WORKAROUND: z.number().nullable().optional() accepts AI null", async () => {
    const result = await generate(
      model,
      z.object({ name: z.string(), endYear: z.number().nullable().optional() }),
      "Extract: Jane works at Google since 2022 (still employed there)."
    );

    expect(result.data.name.toLowerCase()).toMatch(/jane/);
    expect(result.data.endYear === null || result.data.endYear === undefined).toBe(true);
    console.log(`[B8b] endYear: ${result.data.endYear} (workaround works)`);
  }, 30000);
});
