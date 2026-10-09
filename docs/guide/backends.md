# Backends & Guarantee Levels

| Backend | Guarantee | Mechanism |
|---|---|---|
| `openai()` | `native` | Server-side strict JSON schema |
| `groq()` | `native` | JSON mode |
| `deepseek()` | `native` | JSON mode (no schema-strict mode, same tier as `groq()`) |
| `fireworks()` | `native` | Server-side JSON schema mode, plus a real token-level GBNF grammar mode |
| `mistral()` | `native` | Server-side JSON schema mode |
| `gemini()` | `native` | Server-side JSON schema mode (`responseJsonSchema`) |
| `ollama()` | `constrained` | Token-level JSON-schema constraint |
| `llamaCpp()` | `constrained` | Token-level JSON Schema or GBNF grammar (local `.gguf` via node-llama-cpp) |
| `anthropic()` | `best-effort` | Prompt + parse + retry |
| `openRouter()` | `best-effort` | Pass-through to many providers - `response_format` support varies by underlying model |
| `together()` | `native` | Server-side JSON schema mode |
| `cerebras()` | `native` | Server-side strict JSON schema mode |
| `grok()` | `native` | Server-side JSON schema mode |
| `openaiCompatible()` | `best-effort` (override to `native` if your provider enforces it) | Generic factory - see below |

> `llamaCpp()` applies a token-level JSON Schema grammar for Zod and `{ jsonSchema }`
> inputs, and a token-level GBNF grammar for `{ gbnf }`. The JSON Schema grammar
> supports a subset of JSON Schema; Shapecraft still validates the result afterward.
> Other schema types use prompt guidance plus Shapecraft validation/retries.
>
> `fireworks()` is the one cloud backend where a `{ gbnf }` input is *not* downgraded to
> best-effort - Fireworks' grammar mode (`response_format: { type: "grammar", grammar }`)
> applies the GBNF grammar as a genuine token-level constraint server-side, the same
> guarantee `llamaCpp()` gives locally. It reuses the `openai` package pointed at
> Fireworks' base URL, so no extra SDK dependency is needed.
>
> `openRouter()` is deliberately `best-effort`, not `native` like the other cloud
> backends - it's pass-through across many different underlying providers/models, and
> `response_format: { type: "json_schema" }` enforcement isn't guaranteed for every model
> it can route to, only the ones that actually support it themselves.
>
> `gemini()` uses the official `@google/genai` SDK, not an OpenAI-compatible endpoint
> (unlike `fireworks()`/`mistral()`/`openRouter()`) - Gemini's OpenAI-compat layer is a
> migration bridge for OpenAI users, not its primary integration path, and doesn't expose
> `responseJsonSchema` (plain JSON Schema, what `toJsonSchema()` already produces) - only
> the older `responseSchema` (Gemini's own Type-enum OpenAPI-subset shape).
>
> `together()`/`cerebras()`/`grok()` all reuse the `openai` package pointed at their
> respective base URLs, same pattern as `fireworks()`/`mistral()`/`openRouter()` - no new
> SDK dependency. None expose a genuine grammar/constrained-decoding mode, so a `{ gbnf }`
> input on any of the three is prompt-only best-effort, same as `openai()`/`groq()`.

### `openaiCompatible()`

For any OpenAI-compatible provider shapecraft doesn't name explicitly - `baseURL`,
`apiKey`, and `model` are all caller-supplied instead of hardcoded per provider:

```typescript
import { openaiCompatible } from "@aviasole/shapecraft";

const custom = openaiCompatible({
  baseURL: "https://api.some-provider.example/v1",
  apiKey: process.env.SOME_PROVIDER_API_KEY,
  model: "some-model-id",
  guaranteeLevel: "native", // optional - omit to default to "best-effort"
});
```

Defaults to `guaranteeLevel: "best-effort"` since shapecraft can't verify an arbitrary
endpoint actually enforces `json_schema` server-side. Pass `guaranteeLevel: "native"`
explicitly if you know your provider does, for accurate reporting. Unlike the named
backends, there's no environment-variable fallback for the API key - there's no single
conventional env-var name for an arbitrary provider, so `apiKey` is required.

```typescript
import { openai, groq, fireworks, mistral, gemini, openRouter, deepseek, ollama, anthropic, llamaCpp, together, cerebras, grok, openaiCompatible } from "@aviasole/shapecraft";

const gpt       = openai({ model: "gpt-4o-mini" });
const fast      = groq({ model: "llama-3.3-70b-versatile" });
const cloudGbnf = fireworks({ model: "accounts/fireworks/models/llama-v3p1-70b-instruct" });
const mist      = mistral({ model: "mistral-large-latest" });
const gem       = gemini({ model: "gemini-flash-latest" });
const router    = openRouter({ model: "openai/gpt-4o-mini" });
const deep      = deepseek({ model: "deepseek-v4-flash" });
const local     = ollama({ model: "llama3.2" });
const native    = llamaCpp({ modelPath: "./models/llama-3.2-3b.gguf" });
const claude    = anthropic({ model: "claude-haiku-4-5-20251001", maxRetries: 3 });
```

## Model Capabilities

Every built-in backend also exposes `capabilities` - an explicit, inspectable alternative to duck-typing `typeof model.generateStream === "function"` for routing logic:

```typescript
console.log(claude.capabilities);
// { streaming: true, chat: true, structuredOutput: true, toolCalling: true, skillDispatch: true }
```

```typescript
interface ModelCapabilities {
  streaming: boolean;        // has generateStream()
  chat: boolean;             // has chat() - required for turnaround: true
  structuredOutput: boolean; // has generate() - always true
  toolCalling: boolean;      // drives generateWithTools(); true where the backend implements
                              // toolCall(). The llamaCpp() adapter does not implement it yet.
  skillDispatch: boolean;    // generateSkillCall()/runSkillLoop() - always true, built on generate()
}
```

`capabilities` is optional on `ShapecraftModel` - a custom model implementation that predates this field (or simply doesn't set it) still satisfies the interface unchanged, and `model.capabilities` is `undefined` for it. `chat?`/`generateStream?` remain the actual methods the core calls; `capabilities` is just a declared summary of the same information, not a replacement mechanism.

See [Tool Calling](/guide/tool-calling) for `toolCalling`/`generateWithTools()`, and [Skill-Based Generation](/guide/skill-based-generation) for `skillDispatch`.

## Model Cascade

`cascade()` tries models in order within one `generate()` or `generateStream()`
request. A validation failure can move the next attempt to a stronger model;
each new request starts with the first model again.

```typescript
import { cascade, generate, groq, anthropic } from "@aviasole/shapecraft";

const model = cascade([groq(), anthropic()], { escalateAfterFailures: 1 });
const result = await generate(model, schema, prompt, { maxRetries: 3 });
console.log(result.metadata.provider); // provider that produced the accepted result
```

`maxRetries` is the total attempt budget across all models. Transport and rate-limit
errors are not retried by this cascade; it escalates on schema-validation retries.
