import { describe, it, expect } from "vitest";
import { createClient } from "../src/core/client.js";
import { createCostTracker, costTrackingMiddleware } from "../src/core/cost.js";
import type { ShapecraftModel } from "../src/types.js";
import type { Middleware } from "../src/core/middleware.js";

function mockModel(): ShapecraftModel {
  return {
    id: "mock:test",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      return { ok: true } as T;
    },
  };
}

describe("createCostTracker", () => {
  it("starts at zero", () => {
    const tracker = createCostTracker();
    expect(tracker.total).toBe(0);
    expect(tracker.calls).toBe(0);
  });

  it("sums recorded costs and counts calls", () => {
    const tracker = createCostTracker();
    tracker.record(0.002);
    tracker.record(0.0035);
    tracker.record(0.001);
    expect(tracker.total).toBeCloseTo(0.0065, 10);
    expect(tracker.calls).toBe(3);
  });

  it("reset() clears total and calls", () => {
    const tracker = createCostTracker();
    tracker.record(1);
    tracker.record(2);
    tracker.reset();
    expect(tracker.total).toBe(0);
    expect(tracker.calls).toBe(0);
  });
});

describe("costTrackingMiddleware", () => {
  it("records a cost computed from each result via createClient()", async () => {
    const tracker = createCostTracker();
    const costFn = (result: { metadata: { latencyMs: number } }) => result.metadata.latencyMs * 0.0001;
    const client = createClient({ middleware: [costTrackingMiddleware(tracker, costFn)] });

    await client.generate(mockModel(), { validate: () => true }, "x");
    await client.generate(mockModel(), { validate: () => true }, "x");

    expect(tracker.calls).toBe(2);
    expect(tracker.total).toBeGreaterThanOrEqual(0);
  });

  it("does not record anything if the underlying call throws", async () => {
    const tracker = createCostTracker();
    const failingModel: ShapecraftModel = {
      id: "mock:fail",
      guaranteeLevel: "constrained",
      async generate<T>(): Promise<T> {
        throw new Error("network failure");
      },
    };
    const client = createClient({ middleware: [costTrackingMiddleware(tracker, () => 1)] });

    await expect(client.generate(failingModel, { validate: () => true }, "x")).rejects.toThrow("network failure");
    expect(tracker.calls).toBe(0);
    expect(tracker.total).toBe(0);
  });

  it("composes with other middleware (e.g. logging) without interfering", async () => {
    const tracker = createCostTracker();
    const logs: string[] = [];
    const logging: Middleware = async (_ctx, next) => {
      logs.push("before");
      const r = await next();
      logs.push("after");
      return r;
    };
    const client = createClient({
      middleware: [logging, costTrackingMiddleware(tracker, () => 0.5)],
    });

    await client.generate(mockModel(), { validate: () => true }, "x");

    expect(logs).toEqual(["before", "after"]);
    expect(tracker.total).toBe(0.5);
  });
});
