import { TimeoutError } from "../types.js";

export interface TimeoutGuard {
  /** Combined signal to hand to a backend — aborts on timeout OR external abort. `undefined` iff neither was requested, so a backend sees exactly what it saw before this existed. */
  signal: AbortSignal | undefined;
  /** Never resolves; rejects with TimeoutError or the external abort reason. Race this against the real work. */
  guard: Promise<never>;
  /** Always call once the race settles, win or lose — clears the timer and detaches the abort listener. */
  cleanup: () => void;
}

/**
 * Builds the timeout/abort machinery shared by generate() and generateStream().
 * When neither `timeoutMs` nor `externalSignal` is set (the common case today),
 * `signal` is `undefined` and `guard` never settles — racing against it is a
 * no-op, so existing behavior is byte-for-byte unchanged.
 */
export function createTimeoutGuard(timeoutMs: number | undefined, externalSignal: AbortSignal | undefined): TimeoutGuard {
  if (externalSignal?.aborted) {
    return {
      signal: externalSignal,
      guard: Promise.reject(externalSignal.reason ?? new DOMException("Aborted", "AbortError")),
      cleanup: () => {},
    };
  }

  if (!timeoutMs && !externalSignal) {
    return { signal: undefined, guard: new Promise<never>(() => {}), cleanup: () => {} };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onExternalAbort: (() => void) | undefined;

  const guard = new Promise<never>((_, reject) => {
    if (timeoutMs) {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeoutMs));
      }, timeoutMs);
      // Don't let a pending timer keep the process alive on its own.
      timer.unref?.();
    }
    if (externalSignal) {
      onExternalAbort = () => {
        controller.abort();
        reject(externalSignal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      externalSignal.addEventListener("abort", onExternalAbort);
    }
  });

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (onExternalAbort) externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  return { signal: controller.signal, guard, cleanup };
}

/** Combines multiple optional AbortSignals into one that aborts when any of
 * them do. Used by backends that already build their own internal signal
 * (e.g. ollama's request timeout) and need to also honor a caller-supplied
 * one. Avoids relying on `AbortSignal.any` for broader Node compatibility. */
export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => !!s);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];

  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
