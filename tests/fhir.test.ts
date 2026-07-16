import { describe, it, expect } from "vitest";
import type { ShapecraftModel } from "../src/types.js";
import { SchemaViolationError } from "../src/types.js";
import { generate } from "../src/core/generate.js";
import { generateStream } from "../src/core/stream.js";
import { fhir } from "../src/fhir/index.js";

// Mock model that returns a fixed object (bypasses any real backend).
function fixedModel(value: unknown): ShapecraftModel {
  return {
    id: "mock:fhir",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      return value as T;
    },
  };
}

// Mock streaming model that yields a JSON string as character-chunk deltas.
function streamingModel(json: string): ShapecraftModel {
  return {
    id: "mock:fhir-stream",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      return JSON.parse(json) as T;
    },
    async *generateStream(): AsyncIterable<string> {
      for (const ch of json) yield ch;
    },
  };
}

const validPatient = {
  resourceType: "Patient",
  name: [{ family: "Doe", given: ["John"] }],
  gender: "male",
  birthDate: "1990-02-11",
};

describe("fhir presets", () => {
  it("exposes the five R4 resources", () => {
    expect(Object.keys(fhir)).toEqual([
      "Patient",
      "Observation",
      "Condition",
      "MedicationRequest",
      "Encounter",
    ]);
  });

  it("each preset is a genuine { jsonSchema } SchemaInput at runtime", () => {
    // The branded type must not hide the real runtime shape (streaming /
    // incremental validation read schema.jsonSchema.properties).
    for (const preset of Object.values(fhir)) {
      expect(preset).toHaveProperty("jsonSchema");
      expect((preset as { jsonSchema: { properties: unknown } }).jsonSchema.properties).toBeDefined();
    }
  });

  it("validates a well-formed Patient", async () => {
    const model = fixedModel(validPatient);
    const { data } = await generate(model, fhir.Patient, "extract patient");
    expect(data).toEqual(validPatient);
  });

  it("rejects a Patient missing a required field (birthDate)", async () => {
    const model = fixedModel({ resourceType: "Patient", name: [{ family: "Doe" }], gender: "male" });
    await expect(
      generate(model, fhir.Patient, "extract patient", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("enforces the gender value-set enum", async () => {
    const model = fixedModel({ ...validPatient, gender: "M" });
    await expect(
      generate(model, fhir.Patient, "extract patient", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("enforces Observation.status enum and requires code", async () => {
    const badStatus = fixedModel({
      resourceType: "Observation",
      status: "done", // not in enum
      code: { text: "BP" },
    });
    await expect(
      generate(badStatus, fhir.Observation, "extract obs", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);

    const validObs = {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }], text: "Blood pressure" },
      valueQuantity: { value: 120, unit: "mmHg" },
    };
    const { data } = await generate(fixedModel(validObs), fhir.Observation, "extract obs");
    expect(data).toEqual(validObs);
  });

  it("validates MedicationRequest with committed medicationCodeableConcept", async () => {
    const rx = {
      resourceType: "MedicationRequest",
      status: "active",
      intent: "order",
      medicationCodeableConcept: { text: "Metformin 500mg" },
      subject: { reference: "Patient/123" },
    };
    const { data } = await generate(fixedModel(rx), fhir.MedicationRequest, "extract rx");
    expect(data).toEqual(rx);
  });

  it("rejects a required field that is present but empty (constrained-grammar gap)", async () => {
    // Repro: a constrained grammar forces birthDate to appear; the model has no
    // value for it and emits "". `required` must treat that as missing, not pass.
    const model = fixedModel({
      resourceType: "Patient",
      name: [{ text: "J.S." }],
      gender: "unknown",
      birthDate: "",
    });
    await expect(
      generate(model, fhir.Patient, "extract patient", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects an empty array for a required field", async () => {
    const model = fixedModel({
      resourceType: "Patient",
      name: [],
      gender: "male",
      birthDate: "1990-01-01",
    });
    await expect(
      generate(model, fhir.Patient, "extract patient", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("keeps 0 and false as valid required values", async () => {
    // isNonEmpty must not reject falsy-but-real values.
    const schema = {
      jsonSchema: {
        type: "object",
        required: ["count", "active"],
        properties: { count: { type: "number" }, active: { type: "boolean" } },
      },
    };
    const { data } = await generate(fixedModel({ count: 0, active: false }), schema, "x");
    expect(data).toEqual({ count: 0, active: false });
  });

  it("validates a Patient carrying a custom extension", async () => {
    const withExtension = {
      ...validPatient,
      extension: [
        {
          url: "https://hospital-a.example.com/fhir/StructureDefinition/preferred-pharmacy",
          valueString: "Walgreens #4521",
        },
      ],
    };
    const { data } = await generate(fixedModel(withExtension), fhir.Patient, "extract patient");
    expect(data).toEqual(withExtension);
  });

  it("rejects an extension missing its required url", async () => {
    const badExtension = {
      ...validPatient,
      extension: [{ valueString: "no url here" }],
    };
    await expect(
      generate(fixedModel(badExtension), fhir.Patient, "extract patient", { maxRetries: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("emits per-field partial events streaming a Patient", async () => {
    const model = streamingModel(JSON.stringify(validPatient));
    const stream = generateStream(model, fhir.Patient, "extract patient");

    const partialKeys: string[][] = [];
    for await (const event of stream.events) {
      if (event.type === "partial") partialKeys.push(Object.keys(event.value));
    }
    const { data } = await stream.result;

    expect(data).toEqual(validPatient);
    // top-level fields validated incrementally, in order, as each closes
    expect(partialKeys.at(-1)).toEqual(["resourceType", "name", "gender", "birthDate"]);
  });
});
