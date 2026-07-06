/**
 * Example: model.capabilities — explicit feature flags for routing logic.
 *
 * An alternative to duck-typing (`typeof model.generateStream === "function"`)
 * when deciding how to handle a model. All 4 built-in backends populate this;
 * it's optional so a pre-existing custom ShapecraftModel without it still
 * satisfies the interface unchanged.
 */
import { anthropic, ollama } from "@aviasole/shapecraft";
import type { ShapecraftModel } from "@aviasole/shapecraft";

const claude = anthropic({ model: "claude-haiku-4-5-20251001" });
console.log(claude.capabilities);
// { streaming: true, chat: true, structuredOutput: true, toolCalling: false }

// ── Routing: pick a code path based on declared capabilities, not duck-typing ─
function describeModel(model: ShapecraftModel): string {
  if (!model.capabilities) return `${model.id}: capabilities unknown (custom model, assume generate() only)`;

  const features = Object.entries(model.capabilities)
    .filter(([, supported]) => supported)
    .map(([name]) => name);

  return `${model.id}: supports ${features.join(", ")}`;
}

console.log(describeModel(claude));
console.log(describeModel(ollama({ model: "llama3.2" })));

// ── A minimal custom ShapecraftModel doesn't need to declare capabilities ────
const bareModel: ShapecraftModel = {
  id: "custom:bare",
  guaranteeLevel: "best-effort",
  async generate() {
    return { name: "stub" };
  },
};

console.log(describeModel(bareModel));
// custom:bare: capabilities unknown (custom model, assume generate() only)
