# Skill-Based Generation

Let the model pick which of several typed operations to run, with validated arguments - instead of always extracting one fixed shape. Register a set of skills (name, Zod input schema, handler function), and `generateSkillCall()` dispatches to the right one:

```typescript
import { z } from "zod";
import { SkillRegistry, generateSkillCall, runSkill } from "@aviasole/shapecraft";

const registry = new SkillRegistry();

registry.register({
  name: "lookupOrder",
  description: "Look up an order's status by its order ID",
  inputSchema: z.object({ orderId: z.string() }),
  handler: async ({ orderId }) => db.orders.findById(orderId),
});

registry.register({
  name: "sendRefund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  handler: async ({ orderId, amount }) => paymentsApi.refund(orderId, amount),
});

const call = await generateSkillCall(model, registry, "What's the status of order #4521?");
// { skill: "lookupOrder", args: { orderId: "4521" } }

const result = await runSkill(registry, call);
```

`generateSkillCall()` is a thin wrapper around `generate()` - it builds a `z.discriminatedUnion` over every registered skill's `inputSchema` and dispatches through the same retry loop, so `guaranteeLevel` semantics (native/constrained/best-effort) apply per backend exactly like any other call. It uses schema-based dispatch rather than a backend's `toolCall()` method, so it works on every Shapecraft backend, including `llamaCpp()` where `toolCall()` is not implemented.

v1 skill schemas are **Zod only** - that's the mechanism that makes the discriminated-union dispatch work with zero new validation code.

## Looping toward a goal

`runSkillLoop()` repeatedly picks and runs a skill, feeding each result back as context, until a skill marked `terminal: true` succeeds or `maxTurns` is hit:

```typescript
import { runSkillLoop, MaxSkillTurnsExceededError } from "@aviasole/shapecraft";

registry.register({
  name: "sendRefund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  handler: async ({ orderId, amount }) => paymentsApi.refund(orderId, amount),
  terminal: true, // running this successfully ends the loop
});

try {
  const { result, memory } = await runSkillLoop(model, registry, "Refund order #4521");
  console.log(result); // whatever the terminal skill's handler returned
} catch (err) {
  if (err instanceof MaxSkillTurnsExceededError) {
    // err.memory is JSON-serializable — persist it and call runSkillLoop() again
    // with a fresh maxTurns budget (and { memory: err.memory }) to continue.
  }
}
```

A handler that throws - including the terminal skill's own handler - doesn't abort the loop. It's recorded as an error turn and fed back to the model, which can adapt (different arguments, a different skill, or try again) on the next turn. The loop only ever exits early via a thrown `MaxSkillTurnsExceededError`; a successful terminal-skill call is the only path to `{ status: "complete" }`.
