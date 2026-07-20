import type { GenerateResult } from "../types.js";
import type { Middleware } from "./middleware.js";

export interface CostTracker {
  /** Running total across every recorded call. */
  readonly total: number;
  /** Number of calls recorded. */
  readonly calls: number;
  /** Record one completed call's cost. */
  record(cost: number): void;
  /** Reset total/calls back to zero. */
  reset(): void;
}

/**
 * A running total, nothing more. shapecraft doesn't compute $ amounts itself
 * - no built-in per-model pricing tables (that's a real maintenance burden
 * this repo hasn't taken on for anything else, and pricing tables go stale
 * the moment a provider changes rates). You supply the cost per call (from
 * your own pricing logic, e.g. off `result.metadata.tokens`), this just sums
 * what you give it.
 */
export function createCostTracker(): CostTracker {
  let total = 0;
  let calls = 0;
  return {
    get total() {
      return total;
    },
    get calls() {
      return calls;
    },
    record(cost: number) {
      total += cost;
      calls++;
    },
    reset() {
      total = 0;
      calls = 0;
    },
  };
}

/**
 * Sugar for automatic tracking through createClient() - records
 * `costFn(result)` into `tracker` after every successful call. Equivalent to
 * calling `tracker.record(costFn(result))` yourself after each direct
 * `generate()` call; use whichever fits how you're already calling shapecraft.
 * `costFn` only ever needs `result.metadata` (tokens/provider/etc.), so it's
 * typed against `GenerateResult<unknown>` rather than trying to thread
 * `Middleware`'s own per-call generic through a factory-time callback.
 */
export function costTrackingMiddleware(tracker: CostTracker, costFn: (result: GenerateResult<unknown>) => number): Middleware {
  return async (ctx, next) => {
    const result = await next();
    tracker.record(costFn(result));
    return result;
  };
}
