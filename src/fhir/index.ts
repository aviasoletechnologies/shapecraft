/**
 * FHIR R4 preset schemas — a separate, tree-shakeable entrypoint.
 *
 *   import { fhir } from "@aviasole/shapecraft/fhir";
 *   import { generate } from "@aviasole/shapecraft";
 *
 *   const { data } = await generate(model, fhir.Patient, clinicalNote);
 *
 * Each preset is an ordinary `{ jsonSchema }` SchemaInput, so it flows through
 * generate() / generateStream() with zero special-casing. shapecraft guarantees
 * these resources are STRUCTURALLY well-formed and required-fields-complete; it
 * does not and cannot guarantee they are clinically correct. See
 * fhir-support-plan.md §6.
 */
import { Patient } from "./patient.js";
import { Observation } from "./observation.js";
import { Condition } from "./condition.js";
import { MedicationRequest } from "./medication-request.js";
import { Encounter } from "./encounter.js";

export const fhir = {
  Patient,
  Observation,
  Condition,
  MedicationRequest,
  Encounter,
} as const;

export type { Patient } from "./patient.js";
export type { Observation } from "./observation.js";
export type { Condition } from "./condition.js";
export type { MedicationRequest } from "./medication-request.js";
export type { Encounter } from "./encounter.js";
export type {
  Coding,
  CodeableConcept,
  Reference,
  HumanName,
  ContactPoint,
  Address,
  Period,
  Quantity,
  Identifier,
  Extension,
} from "./types.js";
