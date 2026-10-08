# Getting Started

## Install

```bash
npm install @aviasole/shapecraft zod
# or: pnpm add @aviasole/shapecraft zod
```

`zod` is an optional peer dependency, used for the Zod schema examples throughout these docs - install it too if you're using Zod schemas (the common path): `npm install zod`.

Install a backend SDK as needed:

```bash
npm install openai              # OpenAI, Fireworks, Mistral, OpenRouter, DeepSeek, Together, Cerebras, Grok, openaiCompatible
npm install groq-sdk            # Groq
npm install @anthropic-ai/sdk   # Anthropic
npm install @google/genai       # Gemini
npm install node-llama-cpp      # Local .gguf models
# Ollama: no extra SDK needed
```

## Quick Start

```typescript
import { z } from "zod";
import { generate, openai } from "@aviasole/shapecraft";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const model = openai({ model: "gpt-4o-mini" });

const result = await generate(model, PersonSchema, "Extract: John Doe, 32, john@example.com");

console.log(result.data);           // { name: "John Doe", age: 32, email: "john@example.com" }
console.log(result.guaranteeLevel); // "native"
console.log(result.attempts);       // 1
```

## How shapecraft compares

Other libraries solve overlapping parts of this problem well. This is what's actually different, not a scorecard:

| Capability | Instructor-js | zod-gpt | Vercel AI SDK (`generateObject`) | shapecraft |
|---|---|---|---|---|
| Providers | OpenAI only | OpenAI, Anthropic | OpenAI, Anthropic, Google, and more | OpenAI, Groq, Fireworks, Mistral, OpenRouter, DeepSeek, Gemini, Anthropic, Ollama, llama.cpp |
| Local model support | - | - | no grammar-level constraint | Ollama / llama.cpp with token-level schema or GBNF grammar |
| Per-provider reliability signal | - | - | - | `guaranteeLevel`: `native` / `constrained` / `best-effort` |
| Retry on schema failure | not documented | fixed 3 attempts, 60s timeout | configurable `maxRetries` | configurable, only on schema-validation failure |
| Timeout / cancellation | not documented | hardcoded 60s | via provider fetch options | `timeoutMs` / `AbortSignal`, enforced at the core regardless of backend |
| Streaming | yes | - | yes (`streamObject`) | yes, with per-field incremental validation |
| Schema input types | Zod only | Zod only | Zod, Valibot, JSON schema | Zod, JSON schema, regex, custom validator, XML, GBNF |

The gap that actually matters: none of the others tell you *how much* to trust a given provider's structured output, or give local models the same real enforcement cloud providers get. shapecraft's `guaranteeLevel` makes that explicit instead of leaving it as something you find out in production.

## Next steps

- [Schema Inputs](/guide/schema-inputs) - Zod, raw JSON Schema, regex, custom validator, XML, GBNF
- [Backends & Guarantee Levels](/guide/backends) - which mechanism backs each provider
- [Streaming](/guide/streaming) - incremental delivery with the same validation guarantee
- [Multi-agent Orchestration](/guide/agentic) - chain validated `generate()` calls together
- [Tool Calling](/guide/tool-calling) - native provider function-calling with validated arguments
