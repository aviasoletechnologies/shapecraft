/**
 * Example: FHIR R4 preset schemas.
 *
 * `fhir.Patient` etc. are ordinary { jsonSchema } SchemaInputs, so they work
 * with generate() and generateStream() with no special handling — you get a
 * typed, structurally-validated FHIR resource back.
 *
 * shapecraft guarantees the resource is STRUCTURALLY well-formed (required
 * fields present, value-set enums like `gender`/`status` respected, types
 * correct). It does NOT verify clinical correctness or terminology codes
 * (LOINC/SNOMED membership is not checked). See the README "FHIR presets" note.
 */
import { generate, generateStream, anthropic } from "@aviasole/shapecraft";
import { fhir } from "@aviasole/shapecraft/fhir";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

// ── One-shot: extract a Patient from a clinical sentence ────────────────────
const { data: patient } = await generate(
  model,
  fhir.Patient,
  "John Doe, 35-year-old male, date of birth 1990-02-11, lives in Boston."
);
console.log(patient);
// { resourceType: "Patient", name: [{ family: "Doe", given: ["John"] }],
//   gender: "male", birthDate: "1990-02-11", address: [{ city: "Boston" }] }

// ── Streaming: an Observation, with per-field partial validation ────────────
const stream = generateStream(
  model,
  fhir.Observation,
  "Blood pressure reading of 120 mmHg, status final, taken 2024-01-10."
);

for await (const event of stream.events) {
  if (event.type === "partial") console.log("field ready:", event.value);
}
const { data: observation } = await stream.result;
console.log(observation);
// { resourceType: "Observation", status: "final",
//   code: { text: "Blood pressure" }, valueQuantity: { value: 120, unit: "mmHg" } }
