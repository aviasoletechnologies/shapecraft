import type { StreamEvent } from "../../types.js";

/**
 * Single-consumer async channel. Each channel is meant to be iterated by at
 * most one consumer, matching how StreamEmitter's two public views
 * (textStream/events) are actually used.
 */
function createChannel<T>(): { push(item: T): void; end(): void; iterable: AsyncIterable<T> } {
  const buffer: T[] = [];
  let ended = false;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;

  function push(item: T): void {
    if (ended) return;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: item, done: false });
    } else {
      buffer.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) return Promise.resolve({ value: buffer.shift() as T, done: false });
          if (ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };

  return { push, end, iterable };
}

/**
 * Emitter stage: fans a single internal sequence of lifecycle events out
 * into the two public views `StreamHandle` exposes - a raw text-delta
 * channel and a structured lifecycle-event channel - fed from the same
 * underlying `emit()` calls, so `textStream` and `events` always observe the
 * exact same deltas in the same order.
 */
export class StreamEmitter<T> {
  private textChannel = createChannel<string>();
  private eventChannel = createChannel<StreamEvent<T>>();

  emit(event: StreamEvent<T>): void {
    this.eventChannel.push(event);
    if (event.type === "delta") this.textChannel.push(event.text);
  }

  finish(): void {
    this.eventChannel.end();
    this.textChannel.end();
  }

  get textStream(): AsyncIterable<string> {
    return this.textChannel.iterable;
  }

  get events(): AsyncIterable<StreamEvent<T>> {
    return this.eventChannel.iterable;
  }
}
