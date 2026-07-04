import type { SchemaInput } from "../types.js";
import {
  addressSchema,
  contactPointSchema,
  humanNameSchema,
  identifierSchema,
  type Address,
  type ContactPoint,
  type HumanName,
  type Identifier,
} from "./types.js";

/**
 * FHIR R4 Patient (common subset).
 *
 * NOTE on `required`: FHIR itself marks NO Patient field as mandatory (1..1).
 * This preset's required set (name, gender, birthDate) is an OPINIONATED,
 * practical minimum for extraction — not a mirror of FHIR cardinality. See
 * fhir-support-plan.md §5.
 */
export interface Patient {
  resourceType: "Patient";
  identifier?: Identifier[];
  active?: boolean;
  name: HumanName[];
  gender: "male" | "female" | "other" | "unknown";
  birthDate: string; // YYYY-MM-DD — validated as string only, not date format
  telecom?: ContactPoint[];
  address?: Address[];
}

const PatientJsonSchema = {
  type: "object",
  required: ["resourceType", "name", "gender", "birthDate"],
  properties: {
    resourceType: { type: "string", enum: ["Patient"] },
    identifier: { type: "array", items: identifierSchema },
    active: { type: "boolean" },
    name: { type: "array", items: humanNameSchema },
    gender: { type: "string", enum: ["male", "female", "other", "unknown"] },
    birthDate: { type: "string" },
    telecom: { type: "array", items: contactPointSchema },
    address: { type: "array", items: addressSchema },
  },
};

// Runtime value is a genuine { jsonSchema } object (so incremental streaming
// validation and buildStructuredPrompt work); the annotation only narrows the
// result type so generate() returns Patient instead of unknown.
export const Patient: SchemaInput<Patient> = { jsonSchema: PatientJsonSchema };
