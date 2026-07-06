import { describe, it, expect } from "vitest";
import { generateBatch } from "../src/core/batch.js";
import { createClient } from "../src/core/client.js";
import { mockModel } from "./helpers/index.js";
import type { ShapecraftModel } from "../src/types.js";

function delayedMockModel(ms: number, returnValue: unknown, opts: { fail?: boolean; onStart?: () => void; onEnd?: () => void } = {}): ShapecraftModel {
  return {
    id: "mock:batch",
    guaranteeLevel: "constrained",
    async generate<T>(): Promise<T> {
      opts.onStart?.();
      await new Promise((resolve) => setTimeout(resolve, ms));
      opts.onEnd?.();
      if (opts.fail) throw new Error("boom");
      return returnValue as T;
    },
  };
}

describe("generateBatch (standalone)", () => {
  it("runs every item and preserves result order by index", async () => {
    const results = await generateBatch([
      { model: mockModel({ n: 1 }), schema: { validate: () => true }, prompt: "a" },
      { model: mockModel({ n: 2 }), schema: { validate: () => true }, prompt: "b" },
      { model: mockModel({ n: 3 }), schema: { validate: () => true }, prompt: "c" },
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value.data : null))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("settles independently — one item failing doesn't affect the others", async () => {
    const results = await generateBatch([
      { model: mockModel({ ok: true }), schema: { validate: () => true }, prompt: "a" },
      { model: mockModel(null, true), schema: { validate: () => true }, prompt: "b", options: { maxRetries: 1 } },
      { model: mockModel({ ok: true }), schema: { validate: () => true }, prompt: "c" },
    ]);

    expect(results[0]).toMatchObject({ status: "fulfilled" });
    expect(results[1]!.status).toBe("rejected");
    expect(results[2]).toMatchObject({ status: "fulfilled" });
  });

  it("returns an empty array immediately for an empty batch", async () => {
    const results = await generateBatch([]);
    expect(results).toEqual([]);
  });

  it("with no concurrency cap, runs every item in parallel (not serialized)", async () => {
    const n = 5;
    const items = Array.from({ length: n }, (_, i) => ({
      model: delayedMockModel(50, { i }),
      schema: { validate: () => true },
      prompt: `p${i}`,
    }));

    const t0 = Date.now();
    await generateBatch(items);
    const elapsed = Date.now() - t0;

    // Serialized would be ~5*50=250ms; parallel should be close to one 50ms slot.
    expect(elapsed).toBeLessThan(150);
  });

  it("concurrency cap limits how many run at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 6 }, (_, i) => ({
      model: delayedMockModel(30, { i }, {
        onStart: () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
        },
        onEnd: () => inFlight--,
      }),
      schema: { validate: () => true },
      prompt: `p${i}`,
    }));

    await generateBatch(items, { concurrency: 2 });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("client.generateBatch()", () => {
  it("routes each item through the client's own generate() — middleware runs once per item", async () => {
    const order: string[] = [];
    const client = createClient({
      middleware: [
        async (ctx, next) => {
          order.push(`start:${ctx.prompt}`);
          const result = await next();
          order.push(`end:${ctx.prompt}`);
          return result;
        },
      ],
    });

    const results = await client.generateBatch([
      { model: mockModel({ ok: true }), schema: { validate: () => true }, prompt: "one" },
      { model: mockModel({ ok: true }), schema: { validate: () => true }, prompt: "two" },
    ]);

    expect(results).toHaveLength(2);
    expect(order).toContain("start:one");
    expect(order).toContain("end:one");
    expect(order).toContain("start:two");
    expect(order).toContain("end:two");
  });

  it("applies the client's retry default to each item", async () => {
    let calls = 0;
    const flaky = mockModel(null, true);
    const countingModel: ShapecraftModel = {
      ...flaky,
      async generate<T>(): Promise<T> {
        calls++;
        return flaky.generate<T>("", { validate: () => true });
      },
    };

    const client = createClient({ retry: { max: 2 } });
    const results = await client.generateBatch([{ model: countingModel, schema: { validate: () => true }, prompt: "x" }]);

    expect(results[0]!.status).toBe("rejected");
    expect(calls).toBe(2);
  });
});
