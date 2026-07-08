/**
 * Tokenizer stage: wraps a backend's raw delta stream with a shared
 * timeout/abort guard, racing each chunk pull (not the whole stream) so a
 * hung backend still respects timeoutMs/signal instead of blocking
 * generateStream() forever.
 *
 * Closing this generator early (a consumer `break`/`throw` inside a
 * `for await`) always calls `return()` on the underlying source iterator via
 * the `finally` block below, so a backend never keeps producing once nobody
 * downstream is listening - covers both a transport error and an early
 * validation-triggered abort the same way.
 */
export async function* tokenize(source: AsyncIterable<string>, guard: Promise<never>): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), guard]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await iterator.return?.().catch(() => {});
  }
}
