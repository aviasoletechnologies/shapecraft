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
 * FHIR R4 MedicationRequest (a prescription — common subset).
 *
 * `status`, `intent`, `subject` are mandatory (1..1) in FHIR. The medication is
 * a CHOICE type (`medication[x]`); this preset commits to
 * `medicationCodeableConcept` (coded drug) and does not model
 * `medicationReference`. See fhir-support-plan.md §6.
 */
export interface MedicationRequest {
  resourceType: "MedicationRequest";
  status:
    | "active"
    | "on-hold"
    | "cancelled"
    | "completed"
    | "entered-in-error"
    | "stopped"
    | "draft"
    | "unknown";
  intent:
    | "proposal"
    | "plan"
    | "order"
    | "original-order"
    | "reflex-order"
    | "filler-order"
    | "instance-order"
    | "option";
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  authoredOn?: string;
  requester?: Reference;
  dosageInstruction?: { text?: string }[];
  extension?: Extension[];
}

const MedicationRequestJsonSchema = {
  type: "object",
  required: ["resourceType", "status", "intent", "medicationCodeableConcept", "subject"],
  properties: {
    resourceType: { type: "string", enum: ["MedicationRequest"] },
    status: {
      type: "string",
      enum: [
        "active",
        "on-hold",
        "cancelled",
        "completed",
        "entered-in-error",
        "stopped",
        "draft",
        "unknown",
      ],
    },
    intent: {
      type: "string",
      enum: [
        "proposal",
        "plan",
        "order",
        "original-order",
        "reflex-order",
        "filler-order",
        "instance-order",
        "option",
      ],
    },
    medicationCodeableConcept: codeableConceptSchema,
    subject: referenceSchema,
    authoredOn: { type: "string" },
    requester: referenceSchema,
    dosageInstruction: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    },
    extension: { type: "array", items: extensionSchema },
  },
};

export const MedicationRequest: SchemaInput<MedicationRequest> = {
  jsonSchema: MedicationRequestJsonSchema,
};
