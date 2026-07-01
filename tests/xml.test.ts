import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate.js";
import { parseXml, validateXmlOutput, cleanXml, buildXmlSystemPrompt } from "../src/core/xml.js";
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

// ─── generate() with mock model ──────────────────────────────────────────────

describe("generate() with XML schema — mock model", () => {
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
