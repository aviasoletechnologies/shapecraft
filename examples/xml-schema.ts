/**
 * Example: XML output.
 *
 * You give an example XML template with {string}/{number}/{boolean} placeholders
 * and the model fills it in. By default `result.data` is the validated XML string
 * (the format you asked for); add `parse: true` to get a parsed object instead.
 * Output is always validated as well-formed XML, and `required` nodes must be
 * present and non-empty or the call retries.
 */
import { generate, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

// ── Default: XML string back ─────────────────────────────────────────────────
const book = await generate(
  model,
  {
    xml: {
      template: `<book>\n  <title>{string}</title>\n  <author>{string}</author>\n  <year>{number}</year>\n</book>`,
      required: ["title", "author"],
    },
  },
  'Extract: "Clean Code" by Robert C. Martin, 2008.'
);
console.log(book.data);
// "<book>\n  <title>Clean Code</title>\n  <author>Robert C. Martin</author>\n  <year>2008</year>\n</book>"

// ── Attributes & namespaces are reproduced verbatim ──────────────────────────
const catalog = await generate(
  model,
  {
    xml: {
      template: `<xs:catalog xmlns:xs="http://example.com">\n  <xs:book id="{string}" available="{boolean}">\n    <xs:title lang="{string}">{string}</xs:title>\n    <xs:price currency="{string}">{number}</xs:price>\n  </xs:book>\n</xs:catalog>`,
      required: ["xs:book", "xs:title", "xs:price"],
    },
  },
  "Designing Data-Intensive Applications by Martin Kleppmann, ISBN 978-1-4493-7332-0, English, in stock, $54.99 USD."
);
console.log(catalog.data); // namespaced XML string with all attributes filled in

// ── parse: true → typed object ───────────────────────────────────────────────
const person = await generate(
  model,
  {
    xml: {
      template: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>`,
      parse: true,
    },
  },
  "Extract: John Doe, 35 years old."
);
console.log(person.data); // { name: "John Doe", age: 35 }
