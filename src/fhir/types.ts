/**
 * Shared FHIR R4 primitive data types — TypeScript interfaces plus the
 * reusable JSON Schema fragments the resource presets are built from.
 *
 * These model the COMMON subset of each primitive, not the full spec. See
 * fhir-support-plan.md §6 for the honesty ledger on what is / isn't enforced.
 */

// ── TypeScript result interfaces ────────────────────────────────────────────

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface HumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
}

export interface ContactPoint {
  system?: string;
  value?: string;
  use?: string;
}

export interface Address {
  use?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Identifier {
  system?: string;
  value?: string;
}

// ── JSON Schema fragments (embedded by the resource presets) ─────────────────

export const codingSchema = {
  type: "object",
  properties: {
    system: { type: "string" },
    code: { type: "string" },
    display: { type: "string" },
  },
};

export const codeableConceptSchema = {
  type: "object",
  properties: {
    coding: { type: "array", items: codingSchema },
    text: { type: "string" },
  },
};

export const referenceSchema = {
  type: "object",
  properties: {
    reference: { type: "string" },
    display: { type: "string" },
  },
};

export const humanNameSchema = {
  type: "object",
  properties: {
    use: { type: "string" },
    text: { type: "string" },
    family: { type: "string" },
    given: { type: "array", items: { type: "string" } },
    prefix: { type: "array", items: { type: "string" } },
  },
};

export const contactPointSchema = {
  type: "object",
  properties: {
    system: { type: "string" },
    value: { type: "string" },
    use: { type: "string" },
  },
};

export const addressSchema = {
  type: "object",
  properties: {
    use: { type: "string" },
    line: { type: "array", items: { type: "string" } },
    city: { type: "string" },
    state: { type: "string" },
    postalCode: { type: "string" },
    country: { type: "string" },
  },
};

export const periodSchema = {
  type: "object",
  properties: {
    start: { type: "string" },
    end: { type: "string" },
  },
};

export const quantitySchema = {
  type: "object",
  properties: {
    value: { type: "number" },
    unit: { type: "string" },
    system: { type: "string" },
    code: { type: "string" },
  },
};

export const identifierSchema = {
  type: "object",
  properties: {
    system: { type: "string" },
    value: { type: "string" },
  },
};
