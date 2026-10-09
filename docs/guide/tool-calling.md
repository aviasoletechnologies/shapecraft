# Tool Calling

Lets a model call your own functions mid-turn, see the results, and continue - using each provider's **native** tool-calling API, not a prompted convention. The OpenAI-wire-format backends share one implementation; Anthropic and Ollama each have a different wire shape under the hood, normalized to the same interface. This is a different mechanism from `runAgents()`/skill-style dispatch.

```typescript
import { generateWithTools, anthropic } from "@aviasole/shapecraft";
import { z } from "zod";
import type { ToolDefinition } from "@aviasole/shapecraft";

const getWeather: ToolDefinition = {
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: z.object({ city: z.string() }),
  handler: async ({ city }: { city: string }) => ({ city, tempC: 18, condition: "cloudy" }),
};

const result = await generateWithTools(
  anthropic({ model: "claude-haiku-4-5-20251001" }),
  [getWeather],
  z.object({ summary: z.string() }),
  "What's the weather in Lisbon? Use the get_weather tool, then summarize it in one sentence."
);

console.log(result.data);      // { summary: "It's 18°C and cloudy in Lisbon." }
console.log(result.toolCalls); // [{ type: "tool-call", call: { name: "get_weather", args: { city: "Lisbon" } }, result: {...} }]
```

`ToolDefinition.parameters` reuses the same `SchemaInput` machinery as everywhere else in shapecraft (Zod or raw `{ jsonSchema }` - `pattern`/`validate`/`xml` aren't valid tool-parameter shapes and throw clearly if used). The loop runs until the model stops requesting tools, then extracts + validates the final answer through an ordinary `generate()` call over the transcript - the same one-shot extraction pattern `turnaround` mode uses at its completion sentinel, so the structured-answer guarantee is identical to any standalone `generate()` call, not a weaker tool-calling-specific check.

What this does and doesn't guarantee:

- **Tool argument validation is real and structural** - each call's `args` goes through the exact same `SchemaInput` validation pipeline as any `generate()` call, before the handler ever runs. A model producing malformed args fails that step, gets fed back as an error the model can retry from - it never silently reaches your handler.
- **The final answer is validated exactly as strongly as a standalone `generate()` call** with that schema - tool-calling is a different path *to* the same validated-answer guarantee, not a weaker one.
- **Tool *selection* is not validated.** Nothing checks the model picked the "right" tool, or that it should have called one at all - that's inherent model behavior, same structural-vs-semantic gap [Guarantees](/reference/guarantees) documents elsewhere.
- **A tool handler's own correctness is entirely your responsibility.** shapecraft only guarantees the handler's *return value* gets fed back to the model as-is.
- **No loop-prevention beyond `maxTurns`** (default 10) - a model that keeps requesting tools forever throws `MaxToolTurnsExceededError`. A handler that throws aborts immediately with `ToolExecutionError` instead (a business-logic failure, never retried the way a bad argument is - re-prompting the model can't fix a broken handler).

Available on `openai()`, `groq()`, `anthropic()`, `ollama()`, `fireworks()`, `mistral()`, `openRouter()`, `deepseek()` and `gemini()`. The `together()`, `cerebras()`, `grok()`, `openaiCompatible()` and `llamaCpp()` adapters do not implement `toolCall()` yet. Check `model.capabilities.toolCalling` rather than hardcoding either list (see [Backends & Guarantee Levels](/guide/backends)). Tool calling is non-streaming in this version.
