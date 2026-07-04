import type { SchemaInput } from "../types.js";
import {
  codeableConceptSchema,
  quantitySchema,
  referenceSchema,
  type CodeableConcept,
  type Quantity,
  type Reference,
} from "./types.js";

/**
 * FHIR R4 Observation (common subset).
 *
 * `status` and `code` ARE mandatory (1..1) in FHIR, so they are required here
 * for real. The value is a CHOICE type in FHIR (`value[x]`); this preset commits
 * to `valueQuantity` — the numeric-measurement form — and does not model
 * valueString / valueCodeableConcept / component observations. See
 * fhir-support-plan.md §6.
 */
export interface Observation {
  resourceType: "Observation";
  status:
    | "registered"
    | "preliminary"
    | "final"
    | "amended"
    | "corrected"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
}

const ObservationJsonSchema = {
  type: "object",
  required: ["resourceType", "status", "code"],
  properties: {
    resourceType: { type: "string", enum: ["Observation"] },
    status: {
      type: "string",
      enum: [
        "registered",
        "preliminary",
        "final",
        "amended",
        "corrected",
        "cancelled",
        "entered-in-error",
        "unknown",
      ],
    },
    category: { type: "array", items: codeableConceptSchema },
    code: codeableConceptSchema,
    subject: referenceSchema,
    effectiveDateTime: { type: "string" },
    valueQuantity: quantitySchema,
  },
};

export const Observation: SchemaInput<Observation> = { jsonSchema: ObservationJsonSchema };
