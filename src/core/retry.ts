export interface BackoffOptions {
  /** Delay before the first retry, in ms. Default 200. */
  baseMs?: number;
  /** Multiplier applied per subsequent retry. Default 2. */
  factor?: number;
  /** Upper bound on the computed delay, in ms. Default 10000. */
  maxMs?: number;
  /** Randomize each delay in [0, computed] to avoid a thundering herd. Default true. */
  jitter?: boolean;
}

/**
 * Exponential backoff (optionally jittered), for `GenerateOptions.retryDelayMs`.
 * Retries fire immediately by default (`retryDelayMs` unset) - this is an
 * opt-in helper, not a behavior change.
 */
export function exponentialBackoff(opts: BackoffOptions = {}): (attempt: number) => number {
  const { baseMs = 200, factor = 2, maxMs = 10_000, jitter = true } = opts;
  return (attempt: number) => {
    const raw = Math.min(baseMs * factor ** (attempt - 1), maxMs);
    return jitter ? Math.random() * raw : raw;
  };
}

/** Waits `ms`, rejecting early if `signal` aborts first. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
