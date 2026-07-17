import type { SchemaInput } from "../types.js";
import {
  codeableConceptSchema,
  codingSchema,
  extensionSchema,
  periodSchema,
  referenceSchema,
  type CodeableConcept,
  type Coding,
  type Extension,
  type Period,
  type Reference,
} from "./types.js";

/**
 * FHIR R4 Encounter (a visit / admission — common subset).
 *
 * `status` and `class` are mandatory (1..1) in R4. `class` is a single Coding
 * (v2 ActEncounterCode: AMB ambulatory, IMP inpatient, EMER emergency, …), not
 * a CodeableConcept — modeled as such here. See fhir-support-plan.md §5.
 */
export interface Encounter {
  resourceType: "Encounter";
  status:
    | "planned"
    | "arrived"
    | "triaged"
    | "in-progress"
    | "onleave"
    | "finished"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  class: Coding;
  type?: CodeableConcept[];
  subject?: Reference;
  period?: Period;
  reasonCode?: CodeableConcept[];
  extension?: Extension[];
}

const EncounterJsonSchema = {
  type: "object",
  required: ["resourceType", "status", "class"],
  properties: {
    resourceType: { type: "string", enum: ["Encounter"] },
    status: {
      type: "string",
      enum: [
        "planned",
        "arrived",
        "triaged",
        "in-progress",
        "onleave",
        "finished",
        "cancelled",
        "entered-in-error",
        "unknown",
      ],
    },
    class: codingSchema,
    type: { type: "array", items: codeableConceptSchema },
    subject: referenceSchema,
    period: periodSchema,
    reasonCode: { type: "array", items: codeableConceptSchema },
    extension: { type: "array", items: extensionSchema },
  },
};

export const Encounter: SchemaInput<Encounter> = { jsonSchema: EncounterJsonSchema };
