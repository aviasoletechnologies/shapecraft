import type { SchemaInput } from "../types.js";
import {
  codeableConceptSchema,
  extensionSchema,
  referenceSchema,
  type CodeableConcept,
  type Extension,
  type Reference,
} from "./types.js";

/**
 * FHIR R4 Condition (a diagnosis / problem — common subset).
 *
 * `subject` is mandatory (1..1) in FHIR. `clinicalStatus` / `verificationStatus`
 * are bound value sets, but in R4 they are CodeableConcept-shaped (the code sits
 * at coding[].code), so this preset validates their STRUCTURE, not the inner
 * code membership. `code` here is the actual diagnosis. See
 * fhir-support-plan.md §5–6.
 */
export interface Condition {
  resourceType: "Condition";
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
  extension?: Extension[];
}

const ConditionJsonSchema = {
  type: "object",
  required: ["resourceType", "code", "subject"],
  properties: {
    resourceType: { type: "string", enum: ["Condition"] },
    clinicalStatus: codeableConceptSchema,
    verificationStatus: codeableConceptSchema,
    category: { type: "array", items: codeableConceptSchema },
    code: codeableConceptSchema,
    subject: referenceSchema,
    onsetDateTime: { type: "string" },
    recordedDate: { type: "string" },
    extension: { type: "array", items: extensionSchema },
  },
};

export const Condition: SchemaInput<Condition> = { jsonSchema: ConditionJsonSchema };
