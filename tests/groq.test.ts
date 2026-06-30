/**
 * @file groq.test.ts
 *
 * All Groq backend tests in one place.
 * Run: npx vitest run tests/groq.test.ts
 * Needs: GROQ_API_KEY in .env
 *
 * ─── TEST INDEX ────────────────────────────────────────────────────────────
 * Section 1 — Phase 1 Schema Types  (4 tests)  smoke tests per SchemaInput type
 * Section 2 — Extraction Quality    (7 tests)  EASY / MEDIUM complexity
 * Section 3 — Complex Schemas       (4 tests)  nested, cross-field, large schemas
 * Section 4 — Ultra Complex         (7 tests)  discriminated unions, math, multi-lang
 * Section 5 — Real-World Data       (6 tests)  finance, HR, legal, sports, e-commerce
 */

import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { generate, groq } from "../src/index.js";

const hasKey = !!process.env.GROQ_API_KEY;
const itLive = hasKey ? it : it.skip;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Phase 1 Schema Types
// Smoke-tests one test per SchemaInput variant (Zod / jsonSchema / pattern / validate)
// ═══════════════════════════════════════════════════════════════════════════

describe("Section 1 — Phase 1 Schema Types", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  itLive("SMOKE-1 — Zod schema: extracts structured person data", async () => {
    const result = await generate(
      model,
      z.object({ name: z.string(), age: z.number(), occupation: z.string() }),
      "Sarah is a 32-year-old data scientist who works at a tech startup. Extract her info."
    );

    expect(result.data.name.toLowerCase()).toContain("sarah");
    expect(result.data.age).toBe(32);
    expect(result.data.occupation).toBeTruthy();
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("native");
  }, 30000);

  itLive("SMOKE-2 — { jsonSchema }: extracts product info via raw JSON Schema", async () => {
    const result = await generate(
      model,
      {
        jsonSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            price: { type: "number" },
            currency: { type: "string" },
            inStock: { type: "boolean" },
          },
          required: ["title", "price", "currency", "inStock"],
        },
      },
      "The iPhone 15 Pro Max is available for $1199 USD and is currently in stock."
    );

    const data = result.data as { title: string; price: number; currency: string; inStock: boolean };
    expect(data.title).toContain("iPhone");
    expect(data.price).toBe(1199);
    expect(data.currency).toBe("USD");
    expect(data.inStock).toBe(true);
    expect(result.guaranteeLevel).toBe("native");
  }, 30000);

  // Known limitation: Groq forces json_object mode on all calls.
  // Pattern schemas produce a plain-string system prompt (no "json" word) → Groq 400.
  // Bug B5 — tracked in shapecraft-bug-report.test.ts.
  itLive("SMOKE-3 — { pattern }: Groq limitation — throws 400 for pattern schema (B5)", async () => {
    await expect(
      generate(
        model,
        { pattern: /^\d{4}-\d{2}-\d{2}$/ },
        "What is the date of the Apollo 11 moon landing? Return ONLY the date in YYYY-MM-DD format."
      )
    ).rejects.toThrow();
  }, 30000);

  itLive("SMOKE-4 — { validate }: custom validator accepts joke with non-empty joke field", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as Record<string, unknown>;
          return typeof obj.joke === "string" && obj.joke.trim().length > 0;
        },
      },
      'Tell me a short programming joke. Return JSON with a single field "joke" containing the joke text.'
    );

    const data = result.data as { joke: string };
    expect(data.joke.trim().length).toBeGreaterThan(0);
    expect(result.attempts).toBe(1);
    expect(result.guaranteeLevel).toBe("native");
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — Extraction Quality (EASY / MEDIUM)
// ═══════════════════════════════════════════════════════════════════════════

describe("Section 2 — Extraction Quality", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  itLive("EASY-1 — Array of strings: extract skills list from bio", async () => {
    const result = await generate(
      model,
      z.object({ skills: z.array(z.string()) }),
      "John is a full-stack developer skilled in React, TypeScript, Node.js, PostgreSQL, and Docker."
    );

    expect(result.data.skills.length).toBeGreaterThanOrEqual(3);
    const lower = result.data.skills.map((s) => s.toLowerCase());
    expect(lower.some((s) => s.includes("react") || s.includes("typescript") || s.includes("node"))).toBe(true);
  }, 30000);

  itLive("EASY-2 — Enum field: classify sentiment within allowed values", async () => {
    const result = await generate(
      model,
      z.object({
        sentiment: z.enum(["positive", "negative", "neutral"]),
        confidence: z.number().min(0).max(1),
      }),
      "I absolutely love this product! Best purchase I've made all year."
    );

    expect(result.data.sentiment).toBe("positive");
    expect(result.data.confidence).toBeGreaterThan(0);
    expect(result.data.confidence).toBeLessThanOrEqual(1);
  }, 30000);

  itLive("EASY-3 — Optional fields: address with some fields possibly missing", async () => {
    const result = await generate(
      model,
      z.object({
        street: z.string(),
        city: z.string(),
        state: z.string().optional(),
        zip: z.string().optional(),
        country: z.string(),
      }),
      "Ship to 221B Baker Street, London, England."
    );

    expect(result.data.street).toBeTruthy();
    expect(result.data.city.toLowerCase()).toContain("london");
    expect(result.data.country).toBeTruthy();
  }, 30000);

  itLive("MEDIUM-1 — Nested object: invoice with nested customer and line items", async () => {
    const result = await generate(
      model,
      z.object({
        invoiceNumber: z.string(),
        customer: z.object({ name: z.string(), email: z.string() }),
        total: z.number(),
        lineItems: z.array(z.object({
          description: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
        })),
      }),
      `Invoice #INV-2024-007 for customer Alice Johnson (alice@example.com).
       Line items: 2x Web Design at $500 each, 1x Hosting at $99. Total: $1099.`
    );

    expect(result.data.invoiceNumber).toContain("INV-2024-007");
    expect(result.data.customer.name.toLowerCase()).toContain("alice");
    expect(result.data.total).toBe(1099);
    expect(result.data.lineItems.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  itLive("MEDIUM-2 — Multi-entity: extract all people mentioned in a paragraph", async () => {
    const result = await generate(
      model,
      z.object({
        people: z.array(z.object({
          name: z.string(),
          role: z.string(),
          age: z.number().nullable().optional(),
        })),
      }),
      `The meeting was attended by Dr. Emily Chen (CTO, 41), Marcus Williams (lead engineer),
       and Priya Sharma (product manager, 34). The CEO, Robert Park, joined remotely.`
    );

    expect(result.data.people.length).toBeGreaterThanOrEqual(4);
    const names = result.data.people.map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("emily") || n.includes("chen"))).toBe(true);
    expect(names.some((n) => n.includes("robert") || n.includes("park"))).toBe(true);
  }, 30000);

  itLive("MEDIUM-3 — Messy input: extract structured data from OCR-style text", async () => {
    const result = await generate(
      model,
      z.object({
        patientName: z.string(),
        dateOfBirth: z.string(),
        diagnosis: z.string(),
        doctorName: z.string(),
      }),
      `Pt: J0hn Sm1th  DOB: 15-Mar-1978  Dx: Type 2 Diab3tes Mellitus
       Attending: Dr. R. Patel  Visit: 22/06/2026  Rx: Metformin 500mg`
    );

    expect(result.data.patientName.toLowerCase()).toMatch(/j[o0]hn|sm[i1]th/);
    expect(result.data.diagnosis.toLowerCase()).toMatch(/diab[e3]t/);
    expect(result.data.doctorName.toLowerCase()).toMatch(/patel/);
  }, 30000);

  itLive("MEDIUM-4 — Number coercion: prices with formatting should parse to numbers", async () => {
    const result = await generate(
      model,
      z.object({
        originalPrice: z.number(),
        salePrice: z.number(),
        discountPercent: z.number(),
      }),
      `Product was $1,299.99, now on sale for $999.00. That's a 23% discount.`
    );

    expect(result.data.originalPrice).toBeCloseTo(1299.99, 0);
    expect(result.data.salePrice).toBeCloseTo(999, 0);
    expect(result.data.discountPercent).toBeCloseTo(23, 0);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — Complex Schemas
// ═══════════════════════════════════════════════════════════════════════════

describe("Section 3 — Complex Schemas", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  itLive("COMPLEX-1 — Cross-field validate: booking end date must be after start date", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as Record<string, unknown>;
          if (typeof obj.checkIn !== "string" || typeof obj.checkOut !== "string") return false;
          if (typeof obj.guestName !== "string" || typeof obj.roomNumber !== "number") return false;
          return new Date(obj.checkOut as string) > new Date(obj.checkIn as string);
        },
      },
      `Hotel booking for James Brown, room 204. Check-in: July 10 2025, Check-out: July 15 2025.
       Return JSON: guestName (string), roomNumber (number), checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD).`
    );

    const data = result.data as { guestName: string; roomNumber: number; checkIn: string; checkOut: string };
    expect(data.guestName.toLowerCase()).toMatch(/james|brown/);
    expect(data.roomNumber).toBe(204);
    expect(new Date(data.checkOut) > new Date(data.checkIn)).toBe(true);
  }, 30000);

  itLive("COMPLEX-2 — Deep nesting: medical note with diagnoses, each with medications array", async () => {
    const result = await generate(
      model,
      z.object({
        patientId: z.string(),
        visitDate: z.string(),
        diagnoses: z.array(z.object({
          code: z.string(),
          description: z.string(),
          severity: z.enum(["mild", "moderate", "severe"]),
          medications: z.array(z.object({
            name: z.string(),
            dosage: z.string(),
            frequency: z.string(),
          })),
        })),
      }),
      `Patient ID: PT-8821. Visit: 2025-06-20.
       Diagnosis 1: Hypertension (ICD: I10), moderate severity.
         Medications: Lisinopril 10mg once daily, Amlodipine 5mg once daily.
       Diagnosis 2: Type 2 Diabetes (ICD: E11.9), mild severity.
         Medications: Metformin 500mg twice daily.`
    );

    expect(result.data.patientId).toContain("PT-8821");
    expect(result.data.diagnoses.length).toBeGreaterThanOrEqual(2);
    const hypertension = result.data.diagnoses.find((d) =>
      d.description.toLowerCase().includes("hypertens") || d.code === "I10"
    );
    expect(hypertension!.severity).toBe("moderate");
    expect(hypertension!.medications.some((m) => m.name.toLowerCase().includes("lisinopril"))).toBe(true);
  }, 30000);

  itLive("COMPLEX-3 — jsonSchema with enums + nested: flight booking", async () => {
    const result = await generate(
      model,
      {
        jsonSchema: {
          type: "object",
          required: ["flightNumber", "status", "departure", "arrival", "passenger"],
          properties: {
            flightNumber: { type: "string" },
            status: { type: "string", enum: ["scheduled", "delayed", "cancelled", "boarding", "departed"] },
            departure: {
              type: "object", required: ["airport", "city", "time"],
              properties: { airport: { type: "string" }, city: { type: "string" }, time: { type: "string" } },
            },
            arrival: {
              type: "object", required: ["airport", "city", "time"],
              properties: { airport: { type: "string" }, city: { type: "string" }, time: { type: "string" } },
            },
            passenger: {
              type: "object", required: ["name", "seatNumber", "class"],
              properties: {
                name: { type: "string" },
                seatNumber: { type: "string" },
                class: { type: "string", enum: ["economy", "business", "first"] },
              },
            },
          },
        },
      },
      `Flight AI-202 is currently boarding. Departing Mumbai (BOM) at 14:30, arriving Delhi (DEL) at 16:45.
       Passenger: Raj Mehta, seat 12A, business class.`
    );

    const data = result.data as {
      flightNumber: string; status: string;
      departure: { airport: string }; arrival: { airport: string };
      passenger: { name: string; seatNumber: string; class: string };
    };
    expect(data.flightNumber).toMatch(/AI-?202/i);
    expect(data.status).toBe("boarding");
    expect(data.departure.airport).toMatch(/BOM/i);
    expect(data.arrival.airport).toMatch(/DEL/i);
    expect(data.passenger.seatNumber).toBe("12A");
    expect(data.passenger.class).toBe("business");
  }, 30000);

  itLive("COMPLEX-4 — Large schema: extract 12 fields from a job posting", async () => {
    const result = await generate(
      model,
      z.object({
        jobTitle: z.string(),
        company: z.string(),
        location: z.string(),
        remote: z.boolean(),
        salaryMin: z.number().nullable().optional(),
        salaryMax: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        employmentType: z.enum(["full-time", "part-time", "contract", "internship"]),
        experienceYears: z.number(),
        requiredSkills: z.array(z.string()),
        niceToHaveSkills: z.array(z.string()),
        applicationDeadline: z.string().nullable().optional(),
      }),
      `Senior Frontend Engineer at TechCorp (San Francisco, CA — hybrid remote).
       Full-time position. Salary: $140,000–$180,000 USD.
       5+ years experience required. Must know: React, TypeScript, GraphQL, Jest.
       Nice to have: Next.js, Figma, AWS. Apply by August 31, 2025.`
    );

    expect(result.data.jobTitle.toLowerCase()).toMatch(/frontend|engineer/);
    expect(result.data.company.toLowerCase()).toMatch(/techcorp/);
    expect(result.data.remote).toBe(true);
    expect(result.data.employmentType).toBe("full-time");
    expect(result.data.experienceYears).toBeGreaterThanOrEqual(5);
    expect(result.data.requiredSkills.length).toBeGreaterThanOrEqual(3);
    expect(result.data.requiredSkills.some((s) =>
      s.toLowerCase().includes("react") || s.toLowerCase().includes("typescript")
    )).toBe(true);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Ultra Complex
// ═══════════════════════════════════════════════════════════════════════════

describe("Section 4 — Ultra Complex", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  itLive("ULTRA-1 — Discriminated union via validate: card vs bank payment", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as Record<string, unknown>;
          if (obj.type === "card") {
            return (
              typeof obj.cardNumber === "string" &&
              typeof obj.expiryMonth === "number" &&
              typeof obj.expiryYear === "number" &&
              (obj.expiryMonth as number) >= 1 && (obj.expiryMonth as number) <= 12
            );
          }
          if (obj.type === "bank") {
            return typeof obj.accountNumber === "string" &&
              typeof obj.routingNumber === "string" && typeof obj.bankName === "string";
          }
          return false;
        },
      },
      `Customer paid via credit card. Card: 4111-1111-1111-1111, expires 09/2027.
       Return JSON: type="card", cardNumber (string), expiryMonth (number), expiryYear (number).`
    );

    const data = result.data as Record<string, unknown>;
    expect(data.type).toBe("card");
    expect(data.expiryMonth).toBe(9);
    expect(data.expiryYear).toBe(2027);
  }, 30000);

  itLive("ULTRA-2 — Financial math: line items must sum to total within rounding", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as { total: number; lineItems: { amount: number }[] };
          if (!Array.isArray(obj.lineItems) || typeof obj.total !== "number") return false;
          const sum = obj.lineItems.reduce((acc, item) => acc + item.amount, 0);
          return Math.abs(sum - obj.total) < 0.5;
        },
      },
      `Order: Coffee x2 $8.00, Sandwich x1 $12.50, Cookie x3 $7.50, Tax $2.80. Total: $30.80.
       Return JSON: total (number), lineItems (array of {description: string, amount: number}).`
    );

    const data = result.data as { total: number; lineItems: { amount: number }[] };
    expect(data.total).toBeCloseTo(30.80, 0);
    expect(data.lineItems.length).toBeGreaterThanOrEqual(4);
    const sum = data.lineItems.reduce((a, i) => a + i.amount, 0);
    expect(Math.abs(sum - data.total)).toBeLessThan(0.5);
  }, 30000);

  itLive("ULTRA-3 — 3-level org chart: company → departments → employees", async () => {
    const result = await generate(
      model,
      z.object({
        companyName: z.string(),
        departments: z.array(z.object({
          name: z.string(),
          headCount: z.number(),
          employees: z.array(z.object({
            name: z.string(),
            title: z.string(),
            level: z.enum(["junior", "mid", "senior", "lead", "director"]),
          })),
        })),
      }),
      `Acme Corp has 2 departments.
       Engineering (4 people): Alice Kim (senior engineer), Bob Ray (mid engineer),
         Carlos Diaz (lead engineer), Dana Scott (junior engineer).
       Product (2 people): Eva Lin (director of product), Frank Wu (mid product manager).`
    );

    expect(result.data.companyName.toLowerCase()).toMatch(/acme/);
    expect(result.data.departments.length).toBe(2);
    const eng = result.data.departments.find((d) => d.name.toLowerCase().includes("eng"));
    expect(eng!.employees.length).toBe(4);
    expect(eng!.employees.some((e) => e.name.toLowerCase().includes("alice"))).toBe(true);
    const allLevels = result.data.departments.flatMap((d) => d.employees.map((e) => e.level));
    expect(allLevels.every((l) => ["junior", "mid", "senior", "lead", "director"].includes(l))).toBe(true);
  }, 30000);

  itLive("ULTRA-4 — Multi-language: extract from French text into English schema", async () => {
    const result = await generate(
      model,
      z.object({
        name: z.string(),
        age: z.number(),
        city: z.string(),
        occupation: z.string(),
        languages: z.array(z.string()),
      }),
      `Marie Dupont est une ingénieure logicielle de 29 ans qui habite à Paris.
       Elle parle couramment le français, l'anglais et l'espagnol.`
    );

    expect(result.data.name.toLowerCase()).toMatch(/marie|dupont/);
    expect(result.data.age).toBe(29);
    expect(result.data.city.toLowerCase()).toMatch(/paris/);
    expect(result.data.occupation.toLowerCase()).toMatch(/engineer|software|ing[eé]ni|logiciel/);
    expect(result.data.languages.length).toBeGreaterThanOrEqual(3);
  }, 30000);

  itLive("ULTRA-5 — Chronological order: events must be sorted ascending by date", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as { events: { date: string; title: string }[] };
          if (!Array.isArray(obj.events) || obj.events.length < 3) return false;
          for (let i = 1; i < obj.events.length; i++) {
            if (new Date(obj.events[i].date) < new Date(obj.events[i - 1].date)) return false;
          }
          return true;
        },
      },
      `Company milestones (out of order):
       - Series B ($50M) on March 15, 2023
       - Founded on January 5, 2020
       - First product launch on August 22, 2021
       - IPO on November 2, 2024
       Return JSON: events sorted by date ASC, each with date (YYYY-MM-DD) and title.`
    );

    const data = result.data as { events: { date: string; title: string }[] };
    expect(data.events.length).toBe(4);
    for (let i = 1; i < data.events.length; i++) {
      expect(new Date(data.events[i].date).getTime()).toBeGreaterThanOrEqual(
        new Date(data.events[i - 1].date).getTime()
      );
    }
    expect(data.events[0].date).toBe("2020-01-05");
    expect(data.events[3].date).toBe("2024-11-02");
  }, 30000);

  itLive("ULTRA-6 — API doc: extract multiple REST endpoints", async () => {
    const result = await generate(
      model,
      z.object({
        baseUrl: z.string(),
        endpoints: z.array(z.object({
          method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
          path: z.string(),
          description: z.string(),
          requiresAuth: z.boolean(),
          queryParams: z.array(z.string()).optional(),
        })),
      }),
      `Base URL: https://api.example.com/v1
       GET /users — List all users. Auth required. Query params: page, limit, sort.
       POST /users — Create user. Auth required.
       GET /users/:id — Get user by ID. Auth required.
       DELETE /users/:id — Delete user. Auth required.
       GET /health — Health check. No auth.`
    );

    expect(result.data.baseUrl).toContain("api.example.com");
    expect(result.data.endpoints.length).toBe(5);
    const health = result.data.endpoints.find((e) => e.path.includes("health"));
    expect(health!.requiresAuth).toBe(false);
    const getUsers = result.data.endpoints.find((e) => e.method === "GET" && e.path.match(/^\/users$/));
    expect(getUsers!.requiresAuth).toBe(true);
    expect(getUsers!.queryParams!.some((p) => p.toLowerCase().includes("page"))).toBe(true);
  }, 30000);

  itLive("ULTRA-7 — Bulk extraction: 6 products with consistent schema", async () => {
    const result = await generate(
      model,
      z.object({
        products: z.array(z.object({
          id: z.string(),
          name: z.string(),
          price: z.number(),
          category: z.enum(["electronics", "clothing", "food", "books", "home"]),
          rating: z.number().min(1).max(5),
          inStock: z.boolean(),
        })),
      }),
      `Product catalogue:
       SKU-001: Wireless Headphones (electronics) - $79.99, rated 4.5/5, in stock
       SKU-002: Python Programming Book (books) - $34.99, rated 4.8/5, in stock
       SKU-003: Running Shoes (clothing) - $119.00, rated 4.2/5, out of stock
       SKU-004: Coffee Maker (home) - $59.99, rated 3.9/5, in stock
       SKU-005: Organic Coffee Beans (food) - $18.50, rated 4.6/5, in stock
       SKU-006: Bluetooth Speaker (electronics) - $49.99, rated 4.1/5, out of stock`
    );

    expect(result.data.products.length).toBe(6);
    expect(result.data.products.every((p) => p.rating >= 1 && p.rating <= 5)).toBe(true);
    expect(result.data.products.every((p) => p.price > 0)).toBe(true);
    const headphones = result.data.products.find((p) => p.name.toLowerCase().includes("headphone"));
    expect(headphones!.category).toBe("electronics");
    expect(headphones!.inStock).toBe(true);
    const shoes = result.data.products.find((p) => p.name.toLowerCase().includes("shoe"));
    expect(shoes!.inStock).toBe(false);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — Real-World Data
// ═══════════════════════════════════════════════════════════════════════════

describe("Section 5 — Real-World Data", () => {
  let model: ReturnType<typeof groq>;

  beforeAll(() => {
    model = groq();
  });

  itLive("REAL-1 — Balance sheet: assets must equal liabilities + equity", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as { totalAssets: number; totalLiabilities: number; totalEquity: number };
          if (typeof obj.totalAssets !== "number" || typeof obj.totalLiabilities !== "number" ||
              typeof obj.totalEquity !== "number") return false;
          return Math.abs(obj.totalAssets - (obj.totalLiabilities + obj.totalEquity)) < 1;
        },
      },
      `Balance Sheet — Acme Corp (Dec 31, 2024):
       ASSETS: Cash $120,000 | AR $85,000 | Inventory $60,000 | Equipment $200,000 | Total: $465,000
       LIABILITIES: AP $45,000 | LT Debt $150,000 | Total: $195,000
       EQUITY: Common Stock $100,000 | Retained Earnings $170,000 | Total: $270,000
       Return JSON: companyName, reportDate, totalAssets, totalLiabilities, totalEquity,
       assets (array of {name, amount}), liabilities (array of {name, amount}).`
    );

    const data = result.data as { totalAssets: number; totalLiabilities: number; totalEquity: number };
    expect(data.totalAssets).toBe(465000);
    expect(data.totalLiabilities).toBe(195000);
    expect(data.totalEquity).toBe(270000);
    expect(Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity))).toBeLessThan(1);
  }, 30000);

  itLive("REAL-2 — Full resume: education + experience + certifications", async () => {
    const result = await generate(
      model,
      z.object({
        fullName: z.string(),
        email: z.string(),
        phone: z.string(),
        summary: z.string(),
        education: z.array(z.object({
          degree: z.string(),
          institution: z.string(),
          graduationYear: z.number(),
          gpa: z.number().nullable().optional(),
        })),
        experience: z.array(z.object({
          company: z.string(),
          title: z.string(),
          startYear: z.number(),
          endYear: z.number().nullable().optional(),
          current: z.boolean(),
          highlights: z.array(z.string()),
        })),
        certifications: z.array(z.object({
          name: z.string(),
          issuer: z.string(),
          year: z.number(),
        })),
        totalYearsExperience: z.number(),
      }),
      `RESUME
       Name: Ananya Krishnan | Email: ananya.k@email.com | Phone: +91-98765-43210
       SUMMARY: ML engineer with 7 years building production AI systems.
       EDUCATION:
       • M.S. Computer Science — Stanford University, 2018, GPA 3.9
       • B.Tech Electronics — IIT Bombay, 2016, GPA 3.7
       EXPERIENCE:
       • Senior ML Engineer @ Google DeepMind (2021–present)
         - Led training of 70B parameter language model
         - Reduced inference latency by 40%
       • ML Engineer @ Flipkart (2018–2021)
         - Built recommendation engine serving 50M users
       CERTIFICATIONS:
       • AWS Certified ML Specialist — Amazon, 2022
       • TensorFlow Developer Certificate — Google, 2020`
    );

    expect(result.data.fullName.toLowerCase()).toMatch(/ananya|krishnan/);
    expect(result.data.education.length).toBe(2);
    expect(result.data.education.some((e) => e.institution.toLowerCase().includes("stanford"))).toBe(true);
    expect(result.data.experience.length).toBe(2);
    const google = result.data.experience.find((e) =>
      e.company.toLowerCase().includes("google") || e.company.toLowerCase().includes("deepmind")
    );
    expect(google!.current).toBe(true);
    expect(result.data.certifications.length).toBe(2);
    expect(result.data.totalYearsExperience).toBeGreaterThanOrEqual(7);
  }, 30000);

  itLive("REAL-3 — Legal contract: parties, payment terms, penalty, governing law", async () => {
    const result = await generate(
      model,
      z.object({
        contractType: z.string(),
        effectiveDate: z.string(),
        expiryDate: z.string(),
        parties: z.array(z.object({
          role: z.enum(["vendor", "client", "guarantor"]),
          name: z.string(),
          registrationNumber: z.string().nullable().optional(),
        })),
        paymentTerms: z.object({
          amount: z.number(),
          currency: z.string(),
          dueDays: z.number(),
          latePenaltyPercent: z.number(),
        }),
        terminationNoticeDays: z.number(),
        governingLaw: z.string(),
      }),
      `SERVICE AGREEMENT. Effective: January 1, 2025. Expires: December 31, 2025.
       Between: TechSolutions Pvt Ltd (Vendor, Reg: U72900MH2019PTC123456)
       and GlobalRetail Inc (Client, Reg: U52100DL2015PLC098765).
       Payment: USD 50,000 due within 30 days. Late payments incur 1.5% monthly penalty.
       Either party may terminate with 60 days written notice.
       Governed by the laws of the State of Delaware, USA.`
    );

    const vendor = result.data.parties.find((p) => p.role === "vendor");
    expect(vendor!.name.toLowerCase()).toMatch(/techsolutions/);
    const client = result.data.parties.find((p) => p.role === "client");
    expect(client!.name.toLowerCase()).toMatch(/globalretail/);
    expect(result.data.paymentTerms.amount).toBe(50000);
    expect(result.data.paymentTerms.dueDays).toBe(30);
    expect(result.data.paymentTerms.latePenaltyPercent).toBeCloseTo(1.5, 0);
    expect(result.data.terminationNoticeDays).toBe(60);
    expect(result.data.governingLaw.toLowerCase()).toMatch(/delaware/);
  }, 30000);

  itLive("REAL-4 — Sports match: goals with minute + scorer, cards", async () => {
    const result = await generate(
      model,
      z.object({
        competition: z.string(),
        homeTeam: z.object({ name: z.string(), score: z.number() }),
        awayTeam: z.object({ name: z.string(), score: z.number() }),
        result: z.enum(["home_win", "away_win", "draw"]),
        goals: z.array(z.object({
          minute: z.number(),
          scorer: z.string(),
          team: z.string(),
          isPenalty: z.boolean(),
        })),
        yellowCards: z.array(z.object({ minute: z.number(), player: z.string(), team: z.string() })),
        redCards: z.array(z.object({ minute: z.number(), player: z.string(), team: z.string() })),
        manOfTheMatch: z.string(),
      }),
      `Premier League — Arsenal 3–1 Chelsea
       Goals: Saka 23', Martinelli 45' (pen), Havertz 67' (Arsenal); Mudryk 55' (Chelsea).
       Yellow cards: Cucurella (Chelsea) 34', White (Arsenal) 78'.
       Red card: Reece James (Chelsea) 89'. Man of the Match: Bukayo Saka.`
    );

    expect(result.data.homeTeam.score).toBe(3);
    expect(result.data.awayTeam.score).toBe(1);
    expect(result.data.result).toBe("home_win");
    expect(result.data.goals.length).toBe(4);
    const penalty = result.data.goals.find((g) => g.isPenalty);
    expect(penalty!.scorer.toLowerCase()).toMatch(/martinelli/);
    expect(result.data.yellowCards.length).toBe(2);
    expect(result.data.redCards[0].player.toLowerCase()).toMatch(/james/);
    expect(result.data.manOfTheMatch.toLowerCase()).toMatch(/saka/);
  }, 30000);

  itLive("REAL-5 — E-commerce order with partial return: validate refund math", async () => {
    const result = await generate(
      model,
      {
        validate: (x: unknown) => {
          if (typeof x !== "object" || x === null) return false;
          const obj = x as {
            orderTotal: number; refundAmount: number; finalCharge: number;
            items: { unitPrice: number; returned: number }[];
          };
          if (!Array.isArray(obj.items)) return false;
          const chargeOk = Math.abs(obj.finalCharge - (obj.orderTotal - obj.refundAmount)) < 0.5;
          const refundOk = Math.abs(obj.refundAmount -
            obj.items.reduce((s, i) => s + i.returned * i.unitPrice, 0)) < 0.5;
          return chargeOk && refundOk;
        },
      },
      `Order #ORD-9921:
       - Nike Air Max x2 @ $120 = $240 (returned 1)
       - Levi's Jeans x1 @ $89 = $89 (kept)
       - Adidas Cap x3 @ $25 = $75 (returned all 3)
       Order total: $404. Refund: $195. Final charge: $209.
       Return JSON: orderId, orderTotal, refundAmount, finalCharge,
       items (name, quantity, unitPrice, returned).`
    );

    const data = result.data as {
      orderTotal: number; refundAmount: number; finalCharge: number;
      items: { name: string; quantity: number; unitPrice: number; returned: number }[];
    };
    expect(data.orderTotal).toBeCloseTo(404, 0);
    expect(data.refundAmount).toBeCloseTo(195, 0);
    expect(data.finalCharge).toBeCloseTo(209, 0);
    const nike = data.items.find((i) => i.name.toLowerCase().includes("nike") || i.name.toLowerCase().includes("air"));
    expect(nike!.quantity).toBe(2);
    expect(nike!.returned).toBe(1);
  }, 30000);

  itLive("REAL-6 — Multi-city weather: temps, condition enum, 3-day forecast", async () => {
    const conditionEnum = z.enum(["sunny", "cloudy", "rainy", "stormy", "snowy", "foggy", "partly_cloudy"]);

    const result = await generate(
      model,
      z.object({
        reportDate: z.string(),
        cities: z.array(z.object({
          name: z.string(),
          country: z.string(),
          currentTempC: z.number(),
          feelsLikeC: z.number(),
          humidity: z.number().min(0).max(100),
          condition: conditionEnum,
          windSpeedKmh: z.number(),
          forecast: z.array(z.object({
            day: z.string(),
            highC: z.number(),
            lowC: z.number(),
            condition: conditionEnum,
          })),
        })),
      }),
      `Weather Report — June 25, 2025
       Mumbai, India: 34°C (feels 39°C), humidity 82%, partly cloudy, wind 18 km/h.
       3-day: Thu 33/28 rainy | Fri 31/27 stormy | Sat 35/29 partly cloudy.
       London, UK: 19°C (feels 17°C), humidity 65%, cloudy, wind 24 km/h.
       3-day: Thu 21/14 sunny | Fri 18/12 rainy | Sat 20/13 cloudy.
       New York, USA: 28°C (feels 31°C), humidity 71%, sunny, wind 12 km/h.
       3-day: Thu 30/22 sunny | Fri 27/20 partly cloudy | Sat 25/18 rainy.`
    );

    expect(result.data.cities.length).toBe(3);
    const mumbai = result.data.cities.find((c) => c.name.toLowerCase().includes("mumbai"));
    expect(mumbai!.currentTempC).toBe(34);
    expect(mumbai!.humidity).toBe(82);
    expect(mumbai!.condition).toBe("partly_cloudy");
    expect(mumbai!.forecast[1].condition).toBe("stormy");
    const london = result.data.cities.find((c) => c.name.toLowerCase().includes("london"));
    expect(london!.forecast[0].condition).toBe("sunny");
    expect(result.data.cities.every((c) => c.forecast.length === 3)).toBe(true);
  }, 30000);
});
