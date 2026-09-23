import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SchemaInput, ValidatorInput } from "../types.js";
import { buildXmlSystemPrompt } from "./xml.js";
import { buildGbnfSystemPrompt } from "./gbnf.js";
import { buildYamlSystemPrompt } from "./yaml.js";
import { isXmlInput, isGbnfInput, isZodSchema, isYamlInput } from "./validate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  // zod-to-json-schema (last updated for Zod v3's internal shape) silently
  // returns an essentially-empty schema ({ $schema: ... }, no properties/type at
  // all) for a v4 schema instead of erroring - it doesn't recognize v4's reworked
  // internals at all. Confirmed live: every "native"-guarantee backend that
  // validates the schema itself strictly (Cerebras returned a 400) was silently
  // sending this broken empty schema. Zod v4 ships its own native
  // z.toJSONSchema(), which also emits the correct numeric exclusiveMinimum/
  // exclusiveMaximum form (the third-party package's legacy boolean form was a
  // separate, previously-known bug - see the Mistral 422 this comment used to
  // describe).
  //
  // zod is an optional peerDependency (">=3.0.0"), so a consumer's schema may
  // have been built by a *different* zod install than the one bundled here
  // (dual-package hazard). z4.toJSONSchema() reads the schema's own internal
  // shape directly rather than calling a method on it, so calling it on a
  // v3-built schema throws ("Cannot read properties of undefined (reading
  // 'def')") even though our bundled zod is v4. Detect the schema instance's
  // own version via its "_zod" marker (present only on v4-built schemas)
  // instead of trusting which zod happens to be bundled.
  const isV4Schema = typeof schema === "object" && schema !== null && "_zod" in schema;
  const zModule = z as unknown as { toJSONSchema?: (s: unknown) => Record<string, unknown> };
  if (isV4Schema && typeof zModule.toJSONSchema === "function") {
    return zModule.toJSONSchema(schema);
  }
  // jsonSchema7, not the default openApi3 target - openApi3 emits the old OpenAPI
  // 3.0 boolean form for exclusive bounds (`.positive()`/`.negative()`/`.gt()`/`.lt()`)
  // - exclusiveMinimum: true + a separate minimum - instead of the numeric form real
  // JSON Schema requires (exclusiveMinimum: 0). Backends that validate the schema
  // itself strictly (confirmed on Mistral, likely Fireworks too) reject the boolean
  // form outright with a 422 before the model ever runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = zodToJsonSchema(schema as any, { target: "jsonSchema7" }) as Record<string, unknown>;
  delete result.$schema;
  return result;
}

export function buildStructuredPrompt(
  prompt: string,
  schema: SchemaInput,
  systemPrompt?: string
): { system: string; user: string } {
  let schemaInfo: string;

  if (isZodSchema(schema)) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(toJsonSchema(schema), null, 2)}`;
  } else if ("jsonSchema" in schema) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify(schema.jsonSchema, null, 2)}`;
  } else if ("pattern" in schema) {
    schemaInfo = `Respond with a plain string matching this pattern: ${schema.pattern}`;
  } else if (isGbnfInput(schema)) {
    schemaInfo = buildGbnfSystemPrompt(schema);
  } else if (isXmlInput(schema)) {
    schemaInfo = buildXmlSystemPrompt(schema);
  } else if (isYamlInput(schema)) {
    schemaInfo = buildYamlSystemPrompt(schema);
  } else if ("validate" in schema && (schema as ValidatorInput).hint) {
    schemaInfo = `Respond with valid JSON matching this schema exactly:\n\n${JSON.stringify((schema as ValidatorInput).hint, null, 2)}`;
  } else {
    schemaInfo = "Respond with valid JSON. No extra text, no markdown.";
  }

  const system = systemPrompt
    ? `${systemPrompt}\n\n${schemaInfo} No extra text, no markdown, no explanation.`
    : `You are a precise assistant. ${schemaInfo} No extra text, no markdown, no explanation.`;

  return { system, user: prompt };
}
