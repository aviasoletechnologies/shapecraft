import { describe, it, expect, vi } from "vitest";
import { generate } from "../src/core/generate.js";
import {
  parseXml,
  validateXmlOutput,
  cleanXml,
  buildXmlSystemPrompt,
  validateXmlTemplate,
  stripXmlProlog,
  xmlType,
} from "../src/core/xml.js";
import { anthropic } from "../src/backends/anthropic.js";
import { groq } from "../src/backends/groq.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../src/types.js";
import type { XmlInput, ShapecraftModel } from "../src/types.js";

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasGroq = !!process.env.GROQ_API_KEY;

// ─── cleanXml ────────────────────────────────────────────────────────────────

describe("cleanXml", () => {
  it("strips markdown code fences and whitespace", () => {
    expect(cleanXml("```xml\n<book><title>Test</title></book>\n```")).toBe(
      "<book><title>Test</title></book>"
    );
  });
});

// ─── parseXml ────────────────────────────────────────────────────────────────

describe("parseXml", () => {
  it("parses flat XML", () => {
    const result = parseXml("<book><title>XML in Practice</title><author>Jane Smith</author></book>");
    expect(result).toMatchObject({ book: { title: "XML in Practice", author: "Jane Smith" } });
  });

  it("parses nested XML", () => {
    const result = parseXml("<order><id>42</id><address><city>NYC</city></address></order>");
    expect((result as any).order.address.city).toBe("NYC");
  });

  it("captures attributes", () => {
    const result = parseXml('<book id="123"><title>Test</title></book>');
    expect((result as any).book["@_id"]).toBe("123");
  });

  it("normalizes named nodes into arrays", () => {
    const result = parseXml("<library><book><title>A</title></book></library>", ["book"]);
    expect(Array.isArray((result as any).library.book)).toBe(true);
  });
});

// ─── buildXmlSystemPrompt ────────────────────────────────────────────────────

describe("buildXmlSystemPrompt", () => {
  it("wraps the template with instructions", () => {
    const schema: XmlInput = { xml: { template: "<person><name>{string}</name></person>" } };
    const prompt = buildXmlSystemPrompt(schema);
    expect(prompt).toContain("<person>");
    expect(prompt).toContain("valid XML");
  });

  it("instructs the model to preserve non-placeholder text verbatim", () => {
    const schema: XmlInput = { xml: { template: "<person><name>{string}</name></person>" } };
    const prompt = buildXmlSystemPrompt(schema);
    expect(prompt).toMatch(/preserve/i);
  });

  it("throws before the model is called if the template has an invalid placeholder", () => {
    const schema: XmlInput = { xml: { template: '<book edition="{sdasasd}"><title>{string}</title></book>' } };
    expect(() => buildXmlSystemPrompt(schema)).toThrow(/Invalid placeholder/);
  });
});

// ─── xmlType ─────────────────────────────────────────────────────────────────

describe("xmlType", () => {
  it("exposes the three recognized placeholder tokens", () => {
    expect(xmlType.string).toBe("{string}");
    expect(xmlType.number).toBe("{number}");
    expect(xmlType.boolean).toBe("{boolean}");
  });
});

// ─── validateXmlTemplate ──────────────────────────────────────────────────────

describe("validateXmlTemplate", () => {
  it("accepts a template using only {string}/{number}/{boolean}", () => {
    expect(() =>
      validateXmlTemplate(
        '<book id="{string}" available="{boolean}"><title>{string}</title><year>{number}</year></book>'
      )
    ).not.toThrow();
  });

  it("accepts literal (unbraced) text — only {} content is validated", () => {
    // this is the exact case from the bug report: a descriptive literal with
    // no braces at all is not a placeholder and must not be flagged
    expect(() =>
      validateXmlTemplate('<library updated="some-randome-date-before-2026"><title>{string}</title></library>')
    ).not.toThrow();
  });

  it("rejects a garbled placeholder word wrapped in braces", () => {
    // edition="{sdasasd}" from the bug report
    expect(() => validateXmlTemplate('<book edition="{sdasasd}"><title>{string}</title></book>')).toThrow(
      /\{sdasasd\}/
    );
  });

  it("rejects a numeric literal mistakenly wrapped in braces", () => {
    // totalBooks="{90}" from the bug report — braces make it look like a
    // placeholder, but "90" isn't a recognized token
    expect(() => validateXmlTemplate('<library totalBooks="{90}"><title>{string}</title></library>')).toThrow(
      /\{90\}/
    );
  });

  it("rejects another garbled word — name=\"{stringgggg}\"", () => {
    expect(() =>
      validateXmlTemplate('<section name="{stringgggg}"><title>{string}</title></section>')
    ).toThrow(/\{stringgggg\}/);
  });

  it("reports all invalid tokens at once, not just the first", () => {
    try {
      validateXmlTemplate('<book edition="{sdasasd}" pages="{numberz}"><title>{string}</title></book>');
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toContain("{sdasasd}");
      expect(err.message).toContain("{numberz}");
    }
  });

  it("rejects empty braces", () => {
    expect(() => validateXmlTemplate('<book id="{}"><title>{string}</title></book>')).toThrow(/\{\}/);
  });
});

// ─── stripXmlProlog ───────────────────────────────────────────────────────────

describe("stripXmlProlog", () => {
  it("removes a leading XML declaration", () => {
    const withProlog = '<?xml version="1.0" encoding="UTF-8"?>\n<book><title>Test</title></book>';
    expect(stripXmlProlog(withProlog)).toBe("<book><title>Test</title></book>");
  });

  it("leaves content untouched when there is no prolog", () => {
    const noProlog = "<book><title>Test</title></book>";
    expect(stripXmlProlog(noProlog)).toBe(noProlog);
  });

  it("handles a UTF-8 BOM before the declaration", () => {
    const withBom = '﻿<?xml version="1.0"?>\n<book/>';
    expect(stripXmlProlog(withBom)).toBe("<book/>");
  });
});

// ─── validateXmlOutput — required nodes ──────────────────────────────────────

describe("validateXmlOutput — required nodes", () => {
  const schema: XmlInput = {
    xml: { template: "<catalog><books><book>{string}</book></books></catalog>", required: ["books"] },
  };

  it("passes when the required node is present and non-empty", () => {
    const parsed = parseXml("<catalog><books><book>Clean Code</book></books></catalog>");
    expect(() => validateXmlOutput(parsed, schema)).not.toThrow();
  });

  it("throws when the required node is missing", () => {
    const parsed = parseXml("<catalog><title>No books here</title></catalog>");
    expect(() => validateXmlOutput(parsed, schema)).toThrow(SchemaViolationError);
  });

  it("throws when the required node is present but empty", () => {
    const parsed = parseXml("<catalog><books></books></catalog>");
    expect(() => validateXmlOutput(parsed, schema)).toThrow(SchemaViolationError);
  });

  it("finds a required node at any depth", () => {
    const deep: XmlInput = { xml: { template: "<a><b><c>{string}</c></b></a>", required: ["c"] } };
    const parsed = parseXml("<a><b><c>value</c></b></a>");
    expect(() => validateXmlOutput(parsed, deep)).not.toThrow();
  });

  it("no required list → no presence check", () => {
    const loose: XmlInput = { xml: { template: "<book><title>{string}</title></book>" } };
    const parsed = parseXml("<book></book>");
    expect(() => validateXmlOutput(parsed, loose)).not.toThrow();
  });
});

// ─── reconcileLiterals ────────────────────────────────────────────────────────

describe("reconcileLiterals", () => {
  it("forces a root-level literal to the template's value, ignoring the model's output", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    // exact bug scenario: unbraced literal the model "helpfully" replaced
    const template = parseXmlTemplate(
      '<xs:library updated="some-randome-date-after-2026"><xs:title>{string}</xs:title></xs:library>'
    );
    const modelOutput = parseXml('<xs:library updated="2024-05-01"><xs:title>The Road</xs:title></xs:library>');
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled["xs:library"]["@_updated"]).toBe("some-randome-date-after-2026");
    expect(reconciled["xs:library"]["xs:title"]).toBe("The Road"); // placeholder value untouched
  });

  it("preserves an unbraced literal even when the model left it alone", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    const template = parseXmlTemplate('<library totalBooks="90"><title>{string}</title></library>');
    const modelOutput = parseXml('<library totalBooks="90"><title>The Road</title></library>');
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled.library["@_totalBooks"]).toBe("90");
  });

  it("applies the same literal to every item in a repeated array", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    const template = parseXmlTemplate('<lib><book unit="each"><title>{string}</title></book></lib>');
    const modelOutput = parseXml(
      '<lib><book unit="wrong"><title>A</title></book><book unit="also-wrong"><title>B</title></book></lib>'
    );
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled.lib.book[0]["@_unit"]).toBe("each");
    expect(reconciled.lib.book[1]["@_unit"]).toBe("each");
    expect(reconciled.lib.book[0].title).toBe("A"); // placeholders still per-item
    expect(reconciled.lib.book[1].title).toBe("B");
  });

  it("forces a literal in even when the model omitted the whole node", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    const template = parseXmlTemplate('<book><meta source="internal-catalog"/><title>{string}</title></book>');
    const modelOutput = parseXml("<book><title>The Road</title></book>"); // model dropped <meta>
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled.book.meta["@_source"]).toBe("internal-catalog");
  });

  it("does not inject an empty tag for an omitted placeholder-only subtree", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    const template = parseXmlTemplate("<book><optional><note>{string}</note></optional><title>{string}</title></book>");
    const modelOutput = parseXml("<book><title>The Road</title></book>"); // model dropped <optional> entirely
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled.book.optional).toBeUndefined();
  });

  it("keeps extra keys the model added beyond the template", async () => {
    const { parseXmlTemplate, reconcileLiterals } = await import("../src/core/xml.js");
    const template = parseXmlTemplate("<book><title>{string}</title></book>");
    const modelOutput = parseXml("<book><title>The Road</title><isbn>978-1</isbn></book>");
    const reconciled = reconcileLiterals(template, modelOutput) as any;
    expect(reconciled.book.isbn).toBe("978-1");
  });
});

// ─── generate() with mock model ──────────────────────────────────────────────

describe("generate() with XML schema — mock model", () => {
  it("enforceLiterals: fixes an unbraced literal the model changed (root attribute)", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        // model "helpfully" replaced the literal date with one from context
        return '<xs:library updated="2024-05-01"><xs:title>The Road</xs:title></xs:library>' as T;
      },
    };

    const result = await generate(
      model,
      {
        xml: {
          template: '<xs:library updated="some-randome-date-after-2026"><xs:title>{string}</xs:title></xs:library>',
          enforceLiterals: true,
        },
      },
      "Get book"
    );

    expect(result.data).toContain('updated="some-randome-date-after-2026"');
    expect(result.data).toContain("<xs:title>The Road</xs:title>");
  });

  it("enforceLiterals: false (default) leaves the model's altered literal as-is", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return '<xs:library updated="2024-05-01"><xs:title>The Road</xs:title></xs:library>' as T;
      },
    };

    const result = await generate(
      model,
      {
        xml: {
          template: '<xs:library updated="some-randome-date-after-2026"><xs:title>{string}</xs:title></xs:library>',
        },
      },
      "Get book"
    );

    // without enforceLiterals, whatever the model produced passes through unchanged
    expect(result.data).toContain('updated="2024-05-01"');
  });

  it("enforceLiterals: parse: true returns the corrected object", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return '<book totalBooks="99"><title>The Road</title></book>' as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: '<book totalBooks="90"><title>{string}</title></book>', enforceLiterals: true, parse: true } },
      "Get book"
    );

    expect((result.data as any)["@_totalBooks"]).toBe("90");
    expect((result.data as any).title).toBe("The Road");
  });

  it("enforceLiterals: forces literals across every repeated array item", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<lib><book unit=\"wrong\"><title>A</title></book><book unit=\"still-wrong\"><title>B</title></book></lib>" as T;
      },
    };

    const result = await generate(
      model,
      {
        xml: {
          template: '<lib><book unit="each"><title>{string}</title></book></lib>',
          enforceLiterals: true,
          arrays: ["book"],
        },
      },
      "Get catalog"
    );

    const occurrences = (result.data as string).match(/unit="each"/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it("enforceLiterals with prolog: true adds a standard XML declaration", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<book><title>Test</title></book>" as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<book><title>{string}</title></book>", enforceLiterals: true, prolog: true } },
      "Get book"
    );

    expect(result.data).toMatch(/^<\?xml/);
  });
  it("throws synchronously before any model call for an invalid template", async () => {
    const { buildStructuredPrompt } = await import("../src/core/schema.js");
    const generateSpy = vi.fn();
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(prompt: string, schema: any, systemPrompt?: string): Promise<T> {
        // mimic a real backend: build the prompt before making any "API call"
        buildStructuredPrompt(prompt, schema, systemPrompt);
        generateSpy();
        return "<book><title>X</title></book>" as T;
      },
    };

    await expect(
      generate(
        model,
        { xml: { template: '<book edition="{sdasasd}"><title>{string}</title></book>' } },
        "Get book"
      )
    ).rejects.toThrow(/Invalid placeholder/);

    // fails fast — no retries, no wasted model calls
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("default strips a model-added XML prolog", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return '<?xml version="1.0" encoding="UTF-8"?>\n<book><title>Clean Code</title></book>' as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<book><title>{string}</title></book>" } },
      "Get book"
    );

    expect(result.data).not.toContain("<?xml");
    expect(result.data).toBe("<book><title>Clean Code</title></book>");
  });

  it("prolog: true keeps a model-added XML prolog", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return '<?xml version="1.0" encoding="UTF-8"?>\n<book><title>Clean Code</title></book>' as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<book><title>{string}</title></book>", prolog: true } },
      "Get book"
    );

    expect(result.data).toContain("<?xml");
  });

  it("default returns the validated XML string", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<book><title>Clean Code</title></book>" as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<book><title>{string}</title></book>" } },
      "Get book"
    );

    expect(typeof result.data).toBe("string");
    expect(result.data).toContain("<title>Clean Code</title>");
    expect(result.attempts).toBe(1);
  });

  it("parse: true returns the parsed root element", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<person><name>Alice</name><age>30</age></person>" as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<person><name>{string}</name><age>{number}</age></person>", parse: true } },
      "Get person"
    );

    expect((result.data as any).name).toBe("Alice");
  });

  it("attributes survive in the default XML string", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return '<book id="BK-1" available="true"><title>Clean Code</title></book>' as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: '<book id="{string}" available="{boolean}"><title>{string}</title></book>' } },
      "Get book"
    );

    expect(result.data).toContain('id="BK-1"');
    expect(result.data).toContain('available="true"');
  });

  it("required: missing node exhausts retries", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<catalog><title>No books</title></catalog>" as T;
      },
    };

    await expect(
      generate(
        model,
        { xml: { template: "<catalog><books>{string}</books></catalog>", required: ["books"] } },
        "Build catalog",
        { maxRetries: 2 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("required: retries then passes once the node appears", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        calls++;
        if (calls < 2) return "<catalog><title>nope</title></catalog>" as T;
        return "<catalog><books><book>Clean Code</book></books></catalog>" as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<catalog><books><book>{string}</book></books></catalog>", required: ["books"] } },
      "Build catalog"
    );

    expect(result.attempts).toBe(2);
    expect(result.data).toContain("<book>Clean Code</book>");
  });

  it("retries on malformed (structurally invalid) XML output", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        calls++;
        // mismatched tags — fast-xml-parser throws on this
        if (calls < 2) return "<book><title>broken</author></book>" as T;
        return "<book><title>Valid</title></book>" as T;
      },
    };

    const result = await generate(
      model,
      { xml: { template: "<book><title>{string}</title></book>" } },
      "Get book"
    );

    expect(result.attempts).toBe(2);
    expect(result.data).toContain("<title>Valid</title>");
  });
});

// ─── Real API tests ───────────────────────────────────────────────────────────

describe("XML — Anthropic backend (real API)", () => {
  it.skipIf(!hasAnthropic)("returns XML string by default", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      { xml: { template: `<book>\n  <title>{string}</title>\n  <author>{string}</author>\n  <year>{number}</year>\n</book>` } },
      'Extract book info: "XML in Practice" by Jane Smith, published in 2003.'
    );
    expect(typeof result.data).toBe("string");
    expect(result.data).toContain("<title>");
    console.log("[anthropic] xml string:", result.data);
  }, 30_000);

  it.skipIf(!hasAnthropic)("parse: true returns typed object", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      { xml: { template: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>`, parse: true } },
      "Extract: John Doe, 35 years old."
    );
    expect((result.data as any).name).toContain("John");
    console.log("[anthropic] parsed:", result.data);
  }, 30_000);
});

describe("XML — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("returns XML string with required node satisfied", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xml: {
          template: `<book>\n  <title>{string}</title>\n  <author>{string}</author>\n</book>`,
          required: ["title", "author"],
        },
      },
      'Extract book: "Clean Code" by Robert C. Martin.'
    );
    expect(result.data).toContain("<title>");
    expect(result.data).toContain("<author>");
    console.log("[groq] xml string:", result.data);
  }, 30_000);
});
