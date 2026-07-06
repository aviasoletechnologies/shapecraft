import { z } from "zod";
import type { ChatMessage, ModelCallOptions, SchemaInput, ShapecraftModel } from "../types.js";
import { toJsonSchema, buildStructuredPrompt } from "../core/schema.js";
import { isZodSchema } from "../core/validate.js";
import { parseAndValidate } from "../core/parse.js";
import { combineSignals } from "../core/timeout.js";

export interface OllamaBackendOptions {
  model: string;
  host?: string;
  timeoutMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatFor(schema: SchemaInput): any {
  // Pass JSON schema to Ollama's format param for constrained decoding when possible
  if (isZodSchema(schema)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return toJsonSchema(schema as z.ZodType<any>);
  }
  if ("jsonSchema" in (schema as object)) {
    return (schema as { jsonSchema: Record<string, unknown> }).jsonSchema;
  }
  return undefined;
}

export function ollama(options: OllamaBackendOptions): ShapecraftModel {
  const host = options.host ?? "http://localhost:11434";
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    id: `ollama:${options.model}`,
    guaranteeLevel: "constrained",

    async generate<T>(prompt: string, schema: SchemaInput<T>, systemPrompt?: string, callOptions?: ModelCallOptions): Promise<T> {
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);
      const format = formatFor(schema);

      const response = await fetch(`${host}/api/chat`, {
        signal: combineSignals(AbortSignal.timeout(timeoutMs), callOptions?.signal) ?? null,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(format ? { format } : {}),
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as { message?: { content?: string } };
      const raw = json.message?.content ?? "";

      return parseAndValidate<T>(raw, schema);
    },

    async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
      const response = await fetch(`${host}/api/chat`, {
        signal: AbortSignal.timeout(timeoutMs),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as { message?: { content?: string } };
      return json.message?.content ?? "";
    },

    async *generateStream<T>(
      prompt: string,
      schema: SchemaInput<T>,
      systemPrompt?: string,
      callOptions?: ModelCallOptions
    ): AsyncIterable<string> {
      const { system, user } = buildStructuredPrompt(prompt, schema, systemPrompt);
      const format = formatFor(schema);

      const response = await fetch(`${host}/api/chat`, {
        signal: combineSignals(AbortSignal.timeout(timeoutMs), callOptions?.signal) ?? null,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(format ? { format } : {}),
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      // Ollama streams NDJSON — one JSON object per line, last line has done: true.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let ndjsonBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          ndjsonBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = ndjsonBuffer.indexOf("\n")) !== -1) {
            const line = ndjsonBuffer.slice(0, newlineIndex).trim();
            ndjsonBuffer = ndjsonBuffer.slice(newlineIndex + 1);
            if (!line) continue;

            const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (chunk.message?.content) yield chunk.message.content;
            if (chunk.done) return;
          }
        }
      } finally {
        // Runs even on early exit (e.g. the consumer breaks out of a
        // for-await loop, which calls this generator's return()) — releases
        // the underlying stream instead of leaking a locked reader.
        reader.releaseLock();
      }
    },
  };
}
