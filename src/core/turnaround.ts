import { z } from "zod";
import type {
  ChatMessage,
  ConversationMemory,
  GenerateOptions,
  SchemaInput,
  ShapecraftModel,
  TurnaroundOptions,
  TurnResult,
} from "../types.js";
import { MaxTurnsExceededError } from "../types.js";
import { generate } from "./generate.js";
import { isXmlInput, isZodSchema } from "./validate.js";

/** Emitted alone by the model to signal the conversation has everything it needs. */
export const COMPLETION_SENTINEL = "<<<COMPLETE>>>";

export function createConversationMemory(): ConversationMemory {
  return { messages: [], status: "collecting", turns: 0 };
}

/**
 * Best-effort list of the schema's required field names, so the model can be
 * given an explicit checklist instead of inferring "done" purely from prose in
 * the caller's systemPrompt. Returns undefined for schema types with no named
 * fields (pattern, custom validator without a hint) — the checklist is skipped.
 */
function requiredFieldNames<T>(schema: SchemaInput<T>): string[] | undefined {
  if (isZodSchema(schema)) {
    // Read the shape directly rather than going through toJsonSchema — reliable
    // across zod versions and doesn't depend on zod-to-json-schema's internals.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = (schema as any).shape as Record<string, z.ZodTypeAny> | undefined;
    if (!shape) return undefined;
    return Object.entries(shape)
      .filter(([, field]) => !field.isOptional())
      .map(([key]) => key);
  }
  if (isXmlInput(schema)) {
    return schema.xml.required;
  }
  if ("jsonSchema" in (schema as object)) {
    const required = (schema as { jsonSchema: Record<string, unknown> }).jsonSchema.required;
    return Array.isArray(required) ? (required as string[]) : undefined;
  }
  return undefined;
}

function buildTurnaroundSystemPrompt<T>(schema: SchemaInput<T>, systemPrompt?: string): string {
  const required = requiredFieldNames(schema);

  const checklistInstruction = required?.length
    ? `You need clear, specific answers covering exactly these items: ${required.join(", ")}. ` +
      `Ask at most one focused follow-up per item to get a specific answer — do not keep probing an ` +
      `item once it has a clear, specific answer. `
    : "";

  const sentinelInstruction =
    `${checklistInstruction}When — and only when — every item has a clear, specific answer, ` +
    `reply with exactly "${COMPLETION_SENTINEL}" and nothing else — no other words, no punctuation. ` +
    `Until then, reply with exactly one focused question, probe, or acknowledgment per turn. ` +
    `Never include "${COMPLETION_SENTINEL}" in a reply that also contains a question or any other text.`;

  return systemPrompt ? `${systemPrompt}\n\n${sentinelInstruction}` : sentinelInstruction;
}

function transcriptToText(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
}

export async function runTurnaround<T>(
  model: ShapecraftModel,
  schema: SchemaInput<T>,
  userMessage: string,
  options: GenerateOptions,
  turnaroundOptions: TurnaroundOptions
): Promise<TurnResult<T>> {
  if (!model.chat) {
    throw new Error(`Model "${model.id}" does not support turnaround mode (missing chat()).`);
  }

  const memory = turnaroundOptions.memory ?? createConversationMemory();
  if (memory.status === "complete") {
    throw new Error("This conversation has already completed — start a new one.");
  }

  const maxTurns = turnaroundOptions.maxTurns ?? 20;
  memory.turns += 1;
  if (memory.turns > maxTurns) {
    throw new MaxTurnsExceededError(maxTurns);
  }

  memory.messages.push({ role: "user", content: userMessage });

  const turnSystemPrompt = buildTurnaroundSystemPrompt(schema, options.systemPrompt);
  const reply = await model.chat(memory.messages, turnSystemPrompt);
  const trimmed = reply.trim();

  if (trimmed === COMPLETION_SENTINEL) {
    memory.messages.push({ role: "assistant", content: reply });

    // Single structured pass over the whole transcript — a normal, non-turnaround
    // generate() call. This is the ONE validation for the entire conversation.
    const transcript = transcriptToText(memory.messages);
    const extracted = await generate<T>(
      model,
      schema,
      `Extract the structured data collected in the following conversation:\n\n${transcript}`,
      options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}
    );

    memory.status = "complete";
    return { status: "complete", data: extracted.data, memory };
  }

  // Defensive guard (§9): the sentinel should only ever appear alone. If the model
  // leaks it alongside other content, strip it and keep collecting — never forward it.
  const cleaned = trimmed.includes(COMPLETION_SENTINEL) ? trimmed.replace(COMPLETION_SENTINEL, "").trim() : reply;

  memory.messages.push({ role: "assistant", content: cleaned });
  return { status: "collecting", message: cleaned, memory };
}
