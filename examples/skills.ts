/**
 * Example: Skill-based generation — let the model pick which typed operation
 * to run, with validated arguments, instead of always extracting one fixed shape.
 *
 * Each skill's `inputSchema` is Zod (v1 is Zod-only — see
 * skill-based-generation-plan.md). `generateSkillCall()` builds a discriminated
 * union over every registered skill and dispatches through the normal `generate()`
 * pipeline — same retries, same guaranteeLevel semantics, on any backend.
 *
 * `runSkillLoop()` goes further: it repeatedly picks + runs a skill, feeding each
 * result back as context, until a skill marked `terminal: true` succeeds or
 * `maxTurns` is hit.
 */
import { z } from "zod";
import { SkillRegistry, generateSkillCall, runSkill, runSkillLoop, openai, MaxSkillTurnsExceededError } from "@aviasole/shapecraft";

const model = openai({ model: "gpt-4o-mini" });

const registry = new SkillRegistry();

registry.register({
  name: "lookupOrder",
  description: "Look up an order's current status and amount by its order ID",
  inputSchema: z.object({ orderId: z.string() }),
  handler: async ({ orderId }) => {
    // stand-in for a real database/API call
    return { orderId, status: "processing", amount: 42.5 };
  },
});

registry.register({
  name: "sendRefund",
  description: "Issue a refund for an order",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  handler: async ({ orderId, amount }) => {
    return { orderId, refunded: amount };
  },
  terminal: true, // running this successfully ends a runSkillLoop()
});

// --- One-shot: pick a skill, run it, done ---

const call = await generateSkillCall(model, registry, "What's the status of order #4521?");
console.log(call); // { skill: "lookupOrder", args: { orderId: "4521" } }

const result = await runSkill(registry, call);
console.log(result); // { orderId: "4521", status: "processing", amount: 42.5 }

// --- Looping: chain skill calls toward a goal ---
// "Refund order #4521" needs the amount first (from lookupOrder) before sendRefund
// can run — runSkillLoop() figures that sequencing out on its own.

try {
  const { result: finalResult, memory } = await runSkillLoop(model, registry, "Refund order #4521");
  console.log(finalResult); // { orderId: "4521", refunded: 42.5 }
  console.log(memory.turns); // full step-by-step history: lookupOrder -> sendRefund
} catch (err) {
  if (err instanceof MaxSkillTurnsExceededError) {
    // err.memory is JSON-serializable — persist it and call runSkillLoop() again
    // with a fresh maxTurns budget (and { memory: err.memory }) to continue.
    console.error(`Gave up after ${err.turns} turns`, err.memory);
  }
}
