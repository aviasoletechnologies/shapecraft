# createClient() & Middleware

For cross-cutting concerns (logging, caching, telemetry) that would otherwise mean editing `generate()` itself, wrap it once with `createClient()` - a Koa-style onion middleware chain plus client-level defaults.

```typescript
import { createClient, loggingMiddleware } from "@aviasole/shapecraft";

const client = createClient({
  middleware: [loggingMiddleware()],
  retry: { max: 3 },
  timeoutMs: 10_000,
});

const result = await client.generate(model, schema, prompt);
```

A middleware sees the request before `next()` runs and the result/error after - outer middlewares wrap inner ones, like nested boxes, not a flat sequence:

```typescript
import type { Middleware } from "@aviasole/shapecraft";

const timing: Middleware = async (ctx, next) => {
  const t0 = Date.now();
  const result = await next();          // everything below this middleware runs first
  console.log(`${ctx.model.id} took ${Date.now() - t0}ms`);
  return result;
};
```

A middleware that never calls `next()` short-circuits the real call. Use the built-in response cache for repeated calls:

```typescript
import { createClient, responseCacheMiddleware } from "@aviasole/shapecraft";

const client = createClient({ middleware: [responseCacheMiddleware({ ttlMs: 60_000 })] });
await client.generate(model, schema, prompt); // model call
await client.generate(model, schema, prompt); // cache hit
```

The cache keys on model instance, schema, prompt, and simple generation options.
It bypasses calls with validation callbacks, post-processors, abort signals, or
schema inputs it cannot safely key. Zod schemas cache by instance so refinements
cannot share a cached result.

To aggregate caller-supplied costs, use `createCostTracker()` directly or add
`costTrackingMiddleware()`. Shapecraft does not populate `metadata.tokens` yet;
the value in this example is an estimate:

```typescript
import { createClient, createCostTracker, costTrackingMiddleware } from "@aviasole/shapecraft";

const tracker = createCostTracker();
const client = createClient({
  middleware: [costTrackingMiddleware(tracker, () => 0.001)],
});

await client.generate(model, schema, prompt);
console.log(tracker.total, tracker.calls);
```

Every client-level default (`retry`, `timeoutMs`, `jsonSchemaValidator`, `semanticValidator`, `confidenceScorer`, `minConfidence`, `postProcessors`) is merged into each call, and a per-call option always wins over the client-level one.

`createClient()` is purely additive - existing direct calls to `generate()`/`generateStream()` are unaffected. Middleware wraps `generate()` only; `generateStream()` picks up the same client-level defaults but isn't intercepted by middleware (its async-iterable shape doesn't fit the simple before/after `next()` model). `turnaround` calls are out of scope for the client wrapper in v1 - call [`generate()` directly](/guide/turnaround) for those.
