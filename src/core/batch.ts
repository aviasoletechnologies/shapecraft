import type { BatchItem, BatchResult, GenerateBatchOptions, GenerateResult } from "../types.js";
import { generate } from "./generate.js";

/**
 * Runs `items` through `run` with at most `options.concurrency` in flight at
 * once (uncapped if omitted/<= 0), using a shared-index worker pool so
 * results stay ordered by input index regardless of completion order. Never
 * rejects on a single item's failure — each item settles independently,
 * `Promise.allSettled`-style.
 */
export async function runBatch<T>(
  items: BatchItem<T>[],
  run: (item: BatchItem<T>) => Promise<GenerateResult<T>>,
  options: GenerateBatchOptions = {}
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: "fulfilled", value: await run(items[i]!) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const concurrency = options.concurrency && options.concurrency > 0 ? options.concurrency : items.length;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

/** Standalone batch entry point — each item runs through the plain top-level `generate()`. */
export function generateBatch<T>(items: BatchItem<T>[], options?: GenerateBatchOptions): Promise<BatchResult<T>[]> {
  return runBatch(items, (item) => generate<T>(item.model, item.schema, item.prompt, item.options), options);
}
