/**
 * One test-pair per documented XML template rule (README "Template rules").
 * Each rule gets a "follows" test (correct usage, expected outcome) and a
 * "violates" test (what actually happens when the rule is broken — either a
 * thrown error, or a silently wrong/undesired result, matching the real
 * behavior documented for that rule).
 */
import { describe, it, expect, vi } from "vitest";
import { generate } from "../src/core/generate.js";
import { buildStructuredPrompt } from "../src/core/schema.js";
import { xmlType } from "../src/core/xml.js";
import { ollama } from "../src/backends/ollama.js";
import { groq } from "../src/backends/groq.js";
import { MaxRetriesExceededError } from "../src/types.js";
import type { ShapecraftModel, SchemaInput } from "../src/types.js";

const hasOllama = !!process.env.OLLAMA_MODEL;
const ollamaModel = process.env.OLLAMA_MODEL ?? "nemotron-3-super:cloud";
const hasGroq = !!process.env.GROQ_API_KEY;

function mockBackend(responses: string[] | (() => string)): ShapecraftModel {
  let calls = 0;
  const spy = vi.fn();
  return {
    id: "mock",
    guaranteeLevel: "best-effort",
    async generate<T>(prompt: string, schema: any, systemPrompt?: string): Promise<T> {
      // mimic a real backend: build the prompt before "calling the API" —
      // this is what makes template validation fire before any network call
      buildStructuredPrompt(prompt, schema, systemPrompt);
      spy();
      const raw = typeof responses === "function" ? responses() : responses[Math.min(calls, responses.length - 1)];
      calls++;
      return raw as T;
    },
    // exposed for assertions
    // @ts-expect-error test-only field
    __spy: spy,
  };
}

// ─── Rule 1 — only {string}/{number}/{boolean} are valid placeholder tokens ───

describe("Rule 1: placeholder tokens must be exactly {string}/{number}/{boolean}", () => {
  it("FOLLOWS: template using only recognized tokens succeeds", async () => {
    const model = mockBackend(['<book id="BK-1"><title>Clean Code</title></book>']);
    const result = await generate(
      model,
      { xml: { template: `<book id="${xmlType.string}"><title>${xmlType.string}</title></book>` } },
      "Get book"
    );
    expect(result.data).toContain("<title>Clean Code</title>");
  });

  it("VIOLATES: {integer} is not a recognized token — throws before any model call", async () => {
    const model = mockBackend(['<book edition="2"><title>X</title></book>']);
    await expect(
      generate(model, { xml: { template: `<book edition="{integer}"><title>{string}</title></book>` } }, "Get book")
    ).rejects.toThrow(/Invalid placeholder.*\{integer\}/);
    // @ts-expect-error test-only field
    expect(model.__spy).not.toHaveBeenCalled();
  });
});

// ─── Rule 2 — unbraced text is a literal, best-effort preserved ──────────────

describe("Rule 2: unbraced text is a literal (best-effort, not guaranteed)", () => {
  it("FOLLOWS: model leaves the literal alone", async () => {
    const model = mockBackend(['<order status="pending"><id>ORD-1</id></order>']);
    const result = await generate(
      model,
      { xml: { template: `<order status="pending"><id>${xmlType.string}</id></order>` } },
      "Get order"
    );
    expect(result.data).toContain('status="pending"');
  });

  it("VIOLATES: without enforceLiterals, a model that rewrites the literal is not caught", async () => {
    // simulates an LLM "helpfully" changing a literal it wasn't supposed to touch
    const model = mockBackend(['<order status="shipped"><id>ORD-1</id></order>']);
    const result = await generate(
      model,
      { xml: { template: `<order status="pending"><id>${xmlType.string}</id></order>` } },
      "Get order"
    );
    // the library has no way to know "shipped" is wrong — it passes through
    expect(result.data).toContain('status="shipped"');
    expect(result.data).not.toContain('status="pending"');
  });
});

// ─── Rule 3 — attributes follow the same placeholder/literal rules ───────────

describe("Rule 3: attributes follow the same placeholder rules as element text", () => {
  it("FOLLOWS: attribute placeholder uses a recognized token", async () => {
    const model = mockBackend(['<book available="true"><title>X</title></book>']);
    const result = await generate(
      model,
      { xml: { template: `<book available="${xmlType.boolean}"><title>${xmlType.string}</title></book>` } },
      "Get book"
    );
    expect(result.data).toContain('available="true"');
  });

  it("VIOLATES: garbled attribute placeholder throws before any model call", async () => {
    const model = mockBackend(['<book id="X1"><title>X</title></book>']);
    await expect(
      generate(model, { xml: { template: `<book id="{identifier}"><title>{string}</title></book>` } }, "Get book")
    ).rejects.toThrow(/\{identifier\}/);
    // @ts-expect-error test-only field
    expect(model.__spy).not.toHaveBeenCalled();
  });
});

// ─── Rule 4 — namespaces/prefixes are literal text ───────────────────────────

describe("Rule 4: namespace prefixes are literal text, reproduced verbatim", () => {
  it("FOLLOWS: xmlns declared and xs: prefix used consistently", async () => {
    const model = mockBackend([
      '<xs:book xmlns:xs="http://example.com"><xs:title>Clean Code</xs:title></xs:book>',
    ]);
    const result = await generate(
      model,
      {
        xml: {
          template: `<xs:book xmlns:xs="http://example.com"><xs:title>${xmlType.string}</xs:title></xs:book>`,
        },
      },
      "Get book"
    );
    expect(result.data).toContain('xmlns:xs="http://example.com"');
  });

  it("VIOLATES: xs: prefix used without declaring xmlns:xs — not caught, still 'succeeds'", async () => {
    // no xmlns:xs anywhere — not proper namespace-qualified XML, but basic
    // XML well-formedness doesn't require namespace declarations, so nothing
    // in the library flags it
    const model = mockBackend(["<xs:book><xs:title>Clean Code</xs:title></xs:book>"]);
    const result = await generate(
      model,
      { xml: { template: `<xs:book><xs:title>${xmlType.string}</xs:title></xs:book>` } },
      "Get book"
    );
    expect(result.data).not.toContain("xmlns:xs");
    expect(result.data).toContain("<xs:book>"); // "succeeded" despite the missing declaration
  });
});

// ─── Rule 5 — repeated elements: show one example, use `arrays` for parse:true ─

describe("Rule 5: repeated elements need `arrays` to guarantee array shape under parse:true", () => {
  it("FOLLOWS: arrays option forces an array even conceptually for repeats", async () => {
    const model = mockBackend(["<library><book><title>A</title></book><book><title>B</title></book></library>"]);
    const result = await generate(
      model,
      {
        xml: {
          template: `<library><book><title>${xmlType.string}</title></book></library>`,
          arrays: ["book"],
          parse: true,
        },
      },
      "Get library"
    );
    expect(Array.isArray((result.data as any).book)).toBe(true);
    expect((result.data as any).book).toHaveLength(2);
  });

  it("VIOLATES: without `arrays`, a single result collapses to a plain object, not an array", async () => {
    const model = mockBackend(["<library><book><title>A</title></book></library>"]);
    const result = await generate(
      model,
      {
        xml: {
          template: `<library><book><title>${xmlType.string}</title></book></library>`,
          // no `arrays: ["book"]` — the gotcha
          parse: true,
        },
      },
      "Get library"
    );
    // downstream code assuming an array (e.g. .map()) would break here
    expect(Array.isArray((result.data as any).book)).toBe(false);
  });
});

// ─── Rule 6 — required nodes must be present AND non-empty ───────────────────

describe("Rule 6: required nodes must be present and non-empty, or the call retries", () => {
  it("FOLLOWS: required node present and non-empty succeeds on first attempt", async () => {
    const model = mockBackend(['<order><items>widget</items></order>']);
    const result = await generate(
      model,
      { xml: { template: `<order><items>${xmlType.string}</items></order>`, required: ["items"] } },
      "Get order"
    );
    expect(result.attempts).toBe(1);
  });

  it("VIOLATES: required node always empty — exhausts retries", async () => {
    const model = mockBackend(() => "<order><items></items></order>");
    await expect(
      generate(
        model,
        { xml: { template: `<order><items>${xmlType.string}</items></order>`, required: ["items"] } },
        "Get order",
        { maxRetries: 2 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});

// ─── Rule 7 — enforceLiterals guarantees literal fidelity, deterministically ──

describe("Rule 7: enforceLiterals forces literal fidelity even when the model changes it", () => {
  it("FOLLOWS: enforceLiterals: true corrects a model-altered literal", async () => {
    const model = mockBackend(['<catalog totalBooks="99"><title>The Road</title></catalog>']);
    const result = await generate(
      model,
      {
        xml: {
          template: `<catalog totalBooks="90"><title>${xmlType.string}</title></catalog>`,
          enforceLiterals: true,
        },
      },
      "Get catalog"
    );
    expect(result.data).toContain('totalBooks="90"');
  });

  it("VIOLATES: forgetting enforceLiterals lets a critical literal silently drift", async () => {
    const model = mockBackend(['<catalog totalBooks="99"><title>The Road</title></catalog>']);
    const result = await generate(
      model,
      {
        xml: {
          template: `<catalog totalBooks="90"><title>${xmlType.string}</title></catalog>`,
          // enforceLiterals not set — the "90" constant silently becomes "99"
        },
      },
      "Get catalog"
    );
    expect(result.data).toContain('totalBooks="99"');
    expect(result.data).not.toContain('totalBooks="90"');
  });
});

// ─── Rule 8 — <?xml ...?> prolog is stripped by default ──────────────────────

describe("Rule 8: the XML prolog is stripped by default; prolog: true keeps it", () => {
  it("FOLLOWS: prolog: true keeps a model-added declaration", async () => {
    const model = mockBackend(['<?xml version="1.0"?>\n<book><title>X</title></book>']);
    const result = await generate(
      model,
      { xml: { template: `<book><title>${xmlType.string}</title></book>`, prolog: true } },
      "Get book"
    );
    expect(result.data).toMatch(/^<\?xml/);
  });

  it("VIOLATES: expecting the prolog to survive by default — it doesn't", async () => {
    const model = mockBackend(['<?xml version="1.0"?>\n<book><title>X</title></book>']);
    const result = await generate(
      model,
      { xml: { template: `<book><title>${xmlType.string}</title></book>` } }, // no prolog: true
      "Get book"
    );
    expect(result.data).not.toContain("<?xml");
  });
});

// ─── Rule 9 — parse: true returns an object; omitting it returns a string ────

describe("Rule 9: parse: true returns an object; the default is a string", () => {
  it("FOLLOWS: parse: true gives a typed object", async () => {
    const model = mockBackend(['<person><name>John</name><age>35</age></person>']);
    const result = await generate(
      model,
      { xml: { template: `<person><name>${xmlType.string}</name><age>${xmlType.number}</age></person>`, parse: true } },
      "Get person"
    );
    expect(typeof result.data).toBe("object");
    expect((result.data as any).name).toBe("John");
  });

  it("VIOLATES: forgetting parse: true — treating the string result as an object", async () => {
    const model = mockBackend(['<person><name>John</name><age>35</age></person>']);
    const result = await generate(
      model,
      { xml: { template: `<person><name>${xmlType.string}</name><age>${xmlType.number}</age></person>` } }, // no parse: true
      "Get person"
    );
    expect(typeof result.data).toBe("string");
    // the classic mistake: this is undefined, not "John", because result.data is a string
    expect((result.data as any).name).toBeUndefined();
  });
});

// ─── Real Ollama backend — same rules, a real model instead of mocks ─────────

describe("XML rules — Ollama backend (real API)", () => {
  it.skipIf(!hasOllama)("Rule 1: garbled placeholder throws before any Ollama call", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    await expect(
      generate(
        model,
        { xml: { template: `<book edition="{integer}"><title>{string}</title></book>` } },
        "Extract: Clean Code by Robert Martin."
      )
    ).rejects.toThrow(/Invalid placeholder.*\{integer\}/);
  }, 30_000);

  it.skipIf(!hasOllama)("Rule 5: arrays option gives a real multi-item array under parse:true", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const result = await generate(
      model,
      {
        xml: {
          template: `<library><book><title>${xmlType.string}</title></book></library>`,
          arrays: ["book"],
          parse: true,
        },
      },
      "Library has two books: 'Clean Code' and 'The Pragmatic Programmer'."
    );
    expect(Array.isArray((result.data as any).book)).toBe(true);
    console.log("[ollama] rule 5 result:", result.data);
  }, 30_000);

  it.skipIf(!hasOllama)("Rule 6: required node satisfied on real extraction", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const result = await generate(
      model,
      {
        xml: {
          template: `<order><items>${xmlType.string}</items></order>`,
          required: ["items"],
        },
      },
      "Order contains: a widget."
    );
    expect(result.data).toContain("<items>");
    console.log("[ollama] rule 6 result:", result.data, "attempts:", result.attempts);
  }, 30_000);

  it.skipIf(!hasOllama)("Rule 7: enforceLiterals corrects real model drift on an unbraced literal", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const result = await generate(
      model,
      {
        xml: {
          template: `<catalog updated="some-randome-date-after-2026"><title>${xmlType.string}</title></catalog>`,
          enforceLiterals: true,
        },
      },
      "Fiction wing update, dated 2024-05-01. Title: The Road."
    );
    expect(result.data).toContain('updated="some-randome-date-after-2026"');
    console.log("[ollama] rule 7 result:", result.data);
  }, 30_000);

  it.skipIf(!hasOllama)("Rule 9: parse: true returns a real typed object", async () => {
    const model = ollama({ model: ollamaModel, timeoutMs: 120_000 });
    const result = await generate(
      model,
      {
        xml: {
          template: `<person><name>${xmlType.string}</name><age>${xmlType.number}</age></person>`,
          parse: true,
        },
      },
      "Extract: John Doe, 35 years old."
    );
    expect(typeof result.data).toBe("object");
    expect((result.data as any).name).toBeTruthy();
    console.log("[ollama] rule 9 result:", result.data);
  }, 30_000);
});

// ─── Real Groq backend — same rules, a real model instead of mocks ───────────

describe("XML rules — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("Rule 1: garbled placeholder throws before any Groq call", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    await expect(
      generate(
        model,
        { xml: { template: `<book edition="{integer}"><title>{string}</title></book>` } },
        "Extract: Clean Code by Robert Martin."
      )
    ).rejects.toThrow(/Invalid placeholder.*\{integer\}/);
  }, 30_000);

  it.skipIf(!hasGroq)("Rule 5: arrays option gives a real multi-item array under parse:true", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xml: {
          template: `<library><book><title>${xmlType.string}</title></book></library>`,
          arrays: ["book"],
          parse: true,
        },
      },
      "Library has two books: 'Clean Code' and 'The Pragmatic Programmer'."
    );
    expect(Array.isArray((result.data as any).book)).toBe(true);
    console.log("[groq] rule 5 result:", result.data);
  }, 30_000);

  it.skipIf(!hasGroq)("Rule 6: required node satisfied on real extraction", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xml: {
          template: `<order><items>${xmlType.string}</items></order>`,
          required: ["items"],
        },
      },
      "Order contains: a widget."
    );
    expect(result.data).toContain("<items>");
    console.log("[groq] rule 6 result:", result.data, "attempts:", result.attempts);
  }, 30_000);

  it.skipIf(!hasGroq)("Rule 7: enforceLiterals corrects real model drift on an unbraced literal", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xml: {
          template: `<catalog updated="some-randome-date-after-2026"><title>${xmlType.string}</title></catalog>`,
          enforceLiterals: true,
        },
      },
      "Fiction wing update, dated 2024-05-01. Title: The Road."
    );
    expect(result.data).toContain('updated="some-randome-date-after-2026"');
    console.log("[groq] rule 7 result:", result.data);
  }, 30_000);

  it.skipIf(!hasGroq)("Rule 9: parse: true returns a real typed object", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xml: {
          template: `<person><name>${xmlType.string}</name><age>${xmlType.number}</age></person>`,
          parse: true,
        },
      },
      "Extract: John Doe, 35 years old."
    );
    expect(typeof result.data).toBe("object");
    expect((result.data as any).name).toBeTruthy();
    console.log("[groq] rule 9 result:", result.data);
  }, 30_000);
});
