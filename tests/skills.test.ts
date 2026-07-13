import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SkillRegistry, generateSkillCall, runSkill, runSkillLoop } from "../src/core/skills.js";
import { MaxRetriesExceededError, MaxSkillTurnsExceededError, SchemaViolationError, SkillExecutionError } from "../src/types.js";
import type { ShapecraftModel } from "../src/types.js";
import { mockModel } from "./helpers/index.js";

/**
 * Scripted dispatch mock: `replies` are returned in order from `generate()`, one
 * per call - a value to succeed with, or "fail" to throw SchemaViolationError
 * (simulating a dispatch that doesn't match any registered skill, so `generate()`'s
 * own retry loop kicks in).
 */
function scriptedMockModel(replies: (unknown | "fail")[]): ShapecraftModel {
  let call = 0;
  return {
    id: "mock:skills",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      const reply = replies[call];
      call++;
      if (reply === undefined) throw new Error("mock exhausted: no scripted reply for this call");
      if (reply === "fail") throw new SchemaViolationError("bad dispatch", "invalid");
      return reply as T;
    },
  };
}

function registryWithLookup(handler: (args: { orderId: string }) => unknown = (a) => ({ orderId: a.orderId, status: "shipped" })) {
  const registry = new SkillRegistry();
  registry.register({
    name: "lookupOrder",
    description: "Look up an order by ID",
    inputSchema: z.object({ orderId: z.string() }),
    handler,
  });
  return registry;
}

describe("SkillRegistry", () => {
  it("register/get/list round-trip", () => {
    const registry = registryWithLookup();
    expect(registry.get("lookupOrder")?.name).toBe("lookupOrder");
    expect(registry.get("nonexistent")).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.name).toBe("lookupOrder");
  });

  it("rejects a duplicate skill name at registration time", () => {
    const registry = registryWithLookup();
    expect(() =>
      registry.register({
        name: "lookupOrder",
        inputSchema: z.object({}),
        handler: async () => ({}),
      })
    ).toThrow(/already registered/);
  });
});

describe("generateSkillCall", () => {
  it("returns the correct skill+args for a single-skill registry", async () => {
    const registry = registryWithLookup();
    const model = scriptedMockModel([{ skill: "lookupOrder", args: { orderId: "4521" } }]);

    const call = await generateSkillCall(model, registry, "Check on order 4521");
    expect(call).toEqual({ skill: "lookupOrder", args: { orderId: "4521" } });
  });

  it("dispatches to the correct branch of a multi-skill registry", async () => {
    const registry = registryWithLookup();
    registry.register({
      name: "sendRefund",
      inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
      handler: async (a) => ({ refunded: a.amount }),
    });

    const model = scriptedMockModel([{ skill: "sendRefund", args: { orderId: "4521", amount: 20 } }]);
    const call = await generateSkillCall(model, registry, "Refund order 4521 for $20");
    expect(call).toEqual({ skill: "sendRefund", args: { orderId: "4521", amount: 20 } });
  });

  it("retries on a structurally invalid dispatch, same as any other generate() call - proves the thin-wrapper claim", async () => {
    const registry = registryWithLookup();
    const model = scriptedMockModel(["fail", { skill: "lookupOrder", args: { orderId: "4521" } }]);

    const call = await generateSkillCall(model, registry, "Check on order 4521", { maxRetries: 2 });
    expect(call).toEqual({ skill: "lookupOrder", args: { orderId: "4521" } });
  });

  it("exhausts retries and throws MaxRetriesExceededError when dispatch never validates", async () => {
    const registry = registryWithLookup();
    const model = scriptedMockModel(["fail", "fail"]);

    await expect(generateSkillCall(model, registry, "x", { maxRetries: 2 })).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it("throws on an empty registry rather than calling the model", async () => {
    const registry = new SkillRegistry();
    const model = mockModel({});
    await expect(generateSkillCall(model, registry, "x")).rejects.toThrow(/no registered skills/);
  });
});

describe("runSkill (executor)", () => {
  it("calls the matching handler and returns its result", async () => {
    const registry = registryWithLookup();
    const result = await runSkill(registry, { skill: "lookupOrder", args: { orderId: "4521" } });
    expect(result).toEqual({ orderId: "4521", status: "shipped" });
  });

  it("wraps a thrown handler error as SkillExecutionError, not SchemaViolationError", async () => {
    const registry = registryWithLookup(() => {
      throw new Error("database is down");
    });

    await expect(runSkill(registry, { skill: "lookupOrder", args: { orderId: "4521" } })).rejects.toBeInstanceOf(SkillExecutionError);
  });

  it("SkillExecutionError carries the skill name and the original cause", async () => {
    const originalError = new Error("database is down");
    const registry = registryWithLookup(() => {
      throw originalError;
    });

    try {
      await runSkill(registry, { skill: "lookupOrder", args: { orderId: "4521" } });
      throw new Error("unreachable");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillExecutionError);
      const skillErr = err as SkillExecutionError;
      expect(skillErr.skill).toBe("lookupOrder");
      expect(skillErr.cause).toBe(originalError);
    }
  });

  it("throws a plain Error for a call naming an unregistered skill", async () => {
    const registry = registryWithLookup();
    await expect(runSkill(registry, { skill: "doesNotExist", args: {} })).rejects.toThrow(/No skill registered/);
  });
});

describe("runSkillLoop", () => {
  it("terminates on a terminal:true skill and returns its result", async () => {
    const registry = new SkillRegistry();
    registry.register({
      name: "lookupOrder",
      inputSchema: z.object({ orderId: z.string() }),
      handler: async (a: { orderId: string }) => ({ orderId: a.orderId, amount: 20 }),
    });
    registry.register({
      name: "sendRefund",
      inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
      handler: async (a: { orderId: string; amount: number }) => ({ refunded: a.amount }),
      terminal: true,
    });

    const model = scriptedMockModel([
      { skill: "lookupOrder", args: { orderId: "4521" } },
      { skill: "sendRefund", args: { orderId: "4521", amount: 20 } },
    ]);

    const { result, memory } = await runSkillLoop(model, registry, "Refund order 4521");
    expect(result).toEqual({ refunded: 20 });
    expect(memory.status).toBe("complete");
    expect(memory.turnCount).toBe(2);
    expect(memory.turns).toHaveLength(2);
  });

  it("records a handler failure as an error turn and keeps looping instead of aborting", async () => {
    const registry = new SkillRegistry();
    registry.register({
      name: "flaky",
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error("transient failure");
      },
    });
    registry.register({
      name: "finish",
      inputSchema: z.object({}),
      handler: async () => "done",
      terminal: true,
    });

    const model = scriptedMockModel([{ skill: "flaky", args: {} }, { skill: "finish", args: {} }]);

    const { result, memory } = await runSkillLoop(model, registry, "goal");
    expect(result).toBe("done");
    expect(memory.turns[0]).toMatchObject({ call: { skill: "flaky" }, error: "transient failure" });
    expect(memory.turns[1]).toMatchObject({ call: { skill: "finish" }, result: "done" });
  });

  it("a failing terminal skill is also recorded as an error turn, not propagated - the loop keeps going", async () => {
    const registry = new SkillRegistry();
    let attempts = 0;
    registry.register({
      name: "finish",
      inputSchema: z.object({}),
      handler: async () => {
        attempts++;
        if (attempts === 1) throw new Error("first attempt failed");
        return "done";
      },
      terminal: true,
    });

    const model = scriptedMockModel([{ skill: "finish", args: {} }, { skill: "finish", args: {} }]);

    const { result, memory } = await runSkillLoop(model, registry, "goal");
    expect(result).toBe("done");
    expect(memory.turns[0]).toMatchObject({ call: { skill: "finish" }, error: "first attempt failed" });
    expect(memory.turns[1]).toMatchObject({ call: { skill: "finish" }, result: "done" });
    expect(memory.status).toBe("complete");
  });

  it("throws MaxSkillTurnsExceededError, carrying memory, when no terminal skill runs in time", async () => {
    const registry = new SkillRegistry();
    registry.register({
      name: "step",
      inputSchema: z.object({}),
      handler: async () => "ok",
    });

    const model = scriptedMockModel(Array.from({ length: 3 }, () => ({ skill: "step", args: {} })));

    try {
      await runSkillLoop(model, registry, "goal", { maxTurns: 3 });
      throw new Error("unreachable");
    } catch (err) {
      expect(err).toBeInstanceOf(MaxSkillTurnsExceededError);
      const loopErr = err as MaxSkillTurnsExceededError;
      expect(loopErr.turns).toBe(3);
      expect(loopErr.memory.turnCount).toBe(3);
      expect(loopErr.memory.status).toBe("running");
    }
  });

  it("resumes correctly from a passed-in memory instead of starting over", async () => {
    const registry = new SkillRegistry();
    registry.register({
      name: "step",
      inputSchema: z.object({}),
      handler: async () => "ok",
    });
    registry.register({
      name: "finish",
      inputSchema: z.object({}),
      handler: async () => "done",
      terminal: true,
    });

    const model1 = scriptedMockModel(Array.from({ length: 2 }, () => ({ skill: "step", args: {} })));
    let caught: MaxSkillTurnsExceededError | undefined;
    try {
      await runSkillLoop(model1, registry, "goal", { maxTurns: 2 });
    } catch (err) {
      caught = err as MaxSkillTurnsExceededError;
    }
    expect(caught).toBeInstanceOf(MaxSkillTurnsExceededError);

    // Resume with a fresh turn budget, continuing from the saved memory.
    const model2 = scriptedMockModel([{ skill: "finish", args: {} }]);
    const { result, memory } = await runSkillLoop(model2, registry, "goal", { maxTurns: 3, memory: caught!.memory });

    expect(result).toBe("done");
    expect(memory.turnCount).toBe(3); // 2 from before the resume + 1 after
    expect(memory.turns).toHaveLength(3);
  });

  it("refuses to continue a loop whose memory is already complete", async () => {
    const registry = new SkillRegistry();
    const model = mockModel({});
    const completedMemory = { turns: [], status: "complete" as const, turnCount: 1 };

    await expect(runSkillLoop(model, registry, "goal", { memory: completedMemory })).rejects.toThrow(/already completed/);
  });
});
