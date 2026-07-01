import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate.js";
import { xmlObjectToTemplate, parseXml, validateXmlOutput, buildXmlSystemPrompt } from "../src/core/xml.js";
import { anthropic } from "../src/backends/anthropic.js";
import { groq } from "../src/backends/groq.js";
import { MaxRetriesExceededError, SchemaViolationError } from "../src/types.js";
import type { XmlObjectInput, XmlTemplateInput, ShapecraftModel } from "../src/types.js";

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasGroq = !!process.env.GROQ_API_KEY;

// ─── xmlObjectToTemplate ─────────────────────────────────────────────────────

describe("xmlObjectToTemplate", () => {
  it("flat fields", () => {
    const input: XmlObjectInput = {
      xmlObject: { root: "book", fields: { title: "string", author: "string" } },
    };
    const tmpl = xmlObjectToTemplate(input);
    expect(tmpl).toContain("<book>");
    expect(tmpl).toContain("<title>{string}</title>");
    expect(tmpl).toContain("<author>{string}</author>");
    expect(tmpl).toContain("</book>");
  });

  it("nested object field", () => {
    const input: XmlObjectInput = {
      xmlObject: {
        root: "order",
        fields: {
          id: "string",
          address: { type: "object", fields: { city: "string", zip: "string" } },
        },
      },
    };
    const tmpl = xmlObjectToTemplate(input);
    expect(tmpl).toContain("<address>");
    expect(tmpl).toContain("<city>{string}</city>");
  });

  it("array field", () => {
    const input: XmlObjectInput = {
      xmlObject: {
        root: "library",
        fields: {
          books: { type: "array", items: { title: "string", year: "number" } },
        },
      },
    };
    const tmpl = xmlObjectToTemplate(input);
    expect(tmpl).toContain("<books>");
    expect(tmpl).toContain("<item>");
    expect(tmpl).toContain("<year>{number}</year>");
  });
});

// ─── parseXml ────────────────────────────────────────────────────────────────

describe("parseXml", () => {
  it("parses flat XML", () => {
    const raw = "<book><title>XML in Practice</title><author>Jane Smith</author></book>";
    const result = parseXml(raw);
    expect(result).toMatchObject({ book: { title: "XML in Practice", author: "Jane Smith" } });
  });

  it("parses nested XML", () => {
    const raw = "<order><id>42</id><address><city>NYC</city><zip>10001</zip></address></order>";
    const result = parseXml(raw);
    expect((result as any).order.address.city).toBe("NYC");
  });

  it("strips markdown code fences", () => {
    const raw = "```xml\n<book><title>Test</title></book>\n```";
    const result = parseXml(raw);
    expect((result as any).book.title).toBe("Test");
  });

  it("normalizes array paths", () => {
    const raw = "<library><book><title>A</title></book></library>";
    const result = parseXml(raw, ["book"]);
    expect(Array.isArray((result as any).library.book)).toBe(true);
  });

  it("lenient parser handles unclosed tags as empty node", () => {
    const result = parseXml("<unclosed>");
    expect(result).toMatchObject({ unclosed: "" });
  });
});

// ─── validateXmlOutput ───────────────────────────────────────────────────────

describe("validateXmlOutput", () => {
  it("extracts root and coerces types", () => {
    const parsed = { book: { title: "Test", pages: "320" } };
    const schema: XmlObjectInput = {
      xmlObject: { root: "book", fields: { title: "string", pages: "number" } },
    };
    const result = validateXmlOutput(parsed, schema) as any;
    expect(result.title).toBe("Test");
    expect(result.pages).toBe(320);
  });

  it("throws on missing required field", () => {
    const parsed = { book: { title: "Test" } };
    const schema: XmlObjectInput = {
      xmlObject: { root: "book", fields: { title: "string", author: "string" } },
    };
    expect(() => validateXmlOutput(parsed, schema)).toThrow(SchemaViolationError);
  });

  it("throws on missing root element", () => {
    const parsed = { person: { name: "John" } };
    const schema: XmlObjectInput = {
      xmlObject: { root: "book", fields: { title: "string" } },
    };
    expect(() => validateXmlOutput(parsed, schema)).toThrow();
  });

  it("unwraps <item>-wrapped array of objects with nested fields", () => {
    const parsed = {
      company: {
        name: "Globex",
        founded: "1989",
        departments: {
          item: [
            { name: "Engineering", headcount: "42", lead: { fullName: "Jane Roe", yearsExperience: "12" } },
            { name: "Design", headcount: "8", lead: { fullName: "Max Vane", yearsExperience: "7" } },
          ],
        },
      },
    };
    const schema: XmlObjectInput = {
      xmlObject: {
        root: "company",
        fields: {
          name: "string",
          founded: "number",
          departments: {
            type: "array",
            items: {
              name: "string",
              headcount: "number",
              lead: { type: "object", fields: { fullName: "string", yearsExperience: "number" } },
            },
          },
        },
      },
    };
    const result = validateXmlOutput(parsed, schema) as any;
    expect(Array.isArray(result.departments)).toBe(true);
    expect(result.departments).toHaveLength(2);
    expect(result.founded).toBe(1989);
    expect(result.departments[0].headcount).toBe(42);
    expect(result.departments[0].lead.yearsExperience).toBe(12);
  });

  it("single-item array still yields a one-element array", () => {
    const parsed = { company: { tags: { item: { label: "solo" } } } };
    const schema: XmlObjectInput = {
      xmlObject: {
        root: "company",
        fields: { tags: { type: "array", items: { label: "string" } } },
      },
    };
    const result = validateXmlOutput(parsed, schema) as any;
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].label).toBe("solo");
  });

  it("xmlTemplate returns root element", () => {
    const parsed = { book: { title: "Test", author: "Jane" } };
    const schema: XmlTemplateInput = { xmlTemplate: "<book><title>{string}</title></book>" };
    const result = validateXmlOutput(parsed, schema) as any;
    expect(result.title).toBe("Test");
  });
});

// ─── buildXmlSystemPrompt ────────────────────────────────────────────────────

describe("buildXmlSystemPrompt", () => {
  it("includes template structure for xmlObject", () => {
    const schema: XmlObjectInput = {
      xmlObject: { root: "book", fields: { title: "string" } },
    };
    const prompt = buildXmlSystemPrompt(schema);
    expect(prompt).toContain("<book>");
    expect(prompt).toContain("{string}");
  });

  it("uses template string directly for xmlTemplate", () => {
    const schema: XmlTemplateInput = { xmlTemplate: "<person><name>{string}</name></person>" };
    const prompt = buildXmlSystemPrompt(schema);
    expect(prompt).toContain("<person>");
  });
});

// ─── generate() with mock model ──────────────────────────────────────────────

describe("generate() with XML schema — mock model", () => {
  it("xmlObject: parses and validates LLM XML output", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<book><title>XML in Practice</title><author>Jane Smith</author><pages>320</pages></book>" as T;
      },
    };

    const result = await generate(
      model,
      {
        xmlObject: {
          root: "book",
          fields: { title: "string", author: "string", pages: "number" },
        },
      },
      "Extract book info"
    );

    expect(result.data).toMatchObject({ title: "XML in Practice", author: "Jane Smith", pages: 320 });
    expect(result.attempts).toBe(1);
  });

  it("xmlTemplate: parses LLM XML output and returns root element", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<person><name>Alice</name><age>30</age></person>" as T;
      },
    };

    const result = await generate(
      model,
      { xmlTemplate: "<person><name>{string}</name><age>{number}</age></person>" },
      "Extract person info"
    );

    expect((result.data as any).name).toBe("Alice");
  });

  it("retries on invalid XML output", async () => {
    let calls = 0;
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        calls++;
        if (calls < 2) return "not xml at all" as T;
        return "<book><title>Valid</title><author>Author</author></book>" as T;
      },
    };

    const result = await generate(
      model,
      { xmlObject: { root: "book", fields: { title: "string", author: "string" } } },
      "Get book"
    );

    expect(result.attempts).toBe(2);
    expect((result.data as any).title).toBe("Valid");
  });

  it("exhausts retries on consistently bad output", async () => {
    const model: ShapecraftModel = {
      id: "mock",
      guaranteeLevel: "best-effort",
      async generate<T>(): Promise<T> {
        return "<person><name>Alice</name></person>" as T;
      },
    };

    await expect(
      generate(
        model,
        { xmlObject: { root: "book", fields: { title: "string", author: "string" } } },
        "Get book",
        { maxRetries: 2 }
      )
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });
});

// ─── Real API tests ───────────────────────────────────────────────────────────

describe("XML — Anthropic backend (real API)", () => {
  it.skipIf(!hasAnthropic)("xmlObject: flat book extraction", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      { xmlObject: { root: "book", fields: { title: "string", author: "string", year: "number" } } },
      'Extract book info: "XML in Practice" by Jane Smith, published in 2003.'
    );
    expect((result.data as any).title).toContain("XML");
    expect((result.data as any).year).toBe(2003);
    console.log("[anthropic] xmlObject result:", result.data);
  }, 30_000);

  it.skipIf(!hasAnthropic)("xmlTemplate: person extraction", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      {
        xmlTemplate: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n  <city>{string}</city>\n</person>`,
      },
      "Extract: John Doe, 35 years old, lives in San Francisco."
    );
    expect((result.data as any).name).toContain("John");
    expect((result.data as any).age).toBe(35);
    console.log("[anthropic] xmlTemplate result:", result.data);
  }, 30_000);

  it.skipIf(!hasAnthropic)("xmlObject: nested address", async () => {
    const model = anthropic({ model: "claude-haiku-4-5-20251001" });
    const result = await generate(
      model,
      {
        xmlObject: {
          root: "order",
          fields: {
            id: "string",
            address: { type: "object", fields: { city: "string", country: "string" } },
          },
        },
      },
      'Order #ORD-001, shipping to London, United Kingdom.'
    );
    expect((result.data as any).address.city).toBeTruthy();
    console.log("[anthropic] nested result:", result.data);
  }, 30_000);
});

describe("XML — Groq backend (real API)", () => {
  it.skipIf(!hasGroq)("xmlObject: flat extraction", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      { xmlObject: { root: "book", fields: { title: "string", author: "string" } } },
      'Extract book: "Clean Code" by Robert C. Martin.'
    );
    expect((result.data as any).title).toBeTruthy();
    console.log("[groq] xmlObject result:", result.data);
  }, 30_000);

  it.skipIf(!hasGroq)("xmlTemplate: person extraction", async () => {
    const model = groq({ model: "llama-3.3-70b-versatile" });
    const result = await generate(
      model,
      {
        xmlTemplate: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>`,
      },
      "Extract: Sarah Connor, 29 years old."
    );
    expect((result.data as any).name).toBeTruthy();
    console.log("[groq] xmlTemplate result:", result.data);
  }, 30_000);
});
