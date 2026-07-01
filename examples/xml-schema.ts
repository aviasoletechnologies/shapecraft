/**
 * Example: XML output — model returns XML, parsed into a typed JS object
 */
import { generate, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

// ── Option A: xmlObject — declare a root tag and typed fields ────────────────
// Supports nested objects, arrays of objects, and string/number/boolean leaves.
const company = await generate(
  model,
  {
    xmlObject: {
      root: "company",
      fields: {
        name: "string",
        founded: "number",
        headquarters: { type: "object", fields: { city: "string", country: "string" } },
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
  },
  "Globex, founded 1989, HQ in Springfield, USA. Engineering has 42 people led " +
    "by Jane Roe (12 yrs). Design has 8, led by Max Vane (7 yrs)."
);
console.log(company.data);
// {
//   name: "Globex",
//   founded: 1989,
//   headquarters: { city: "Springfield", country: "USA" },
//   departments: [
//     { name: "Engineering", headcount: 42, lead: { fullName: "Jane Roe", yearsExperience: 12 } },
//     { name: "Design", headcount: 8, lead: { fullName: "Max Vane", yearsExperience: 7 } },
//   ],
// }

// ── Option B: xmlTemplate — give an example shape with {placeholder} values ───
const person = await generate(
  model,
  { xmlTemplate: `<person>\n  <name>{string}</name>\n  <age>{number}</age>\n</person>` },
  "Extract: John Doe, 35 years old."
);
console.log(person.data); // { name: "John Doe", age: 35 }
