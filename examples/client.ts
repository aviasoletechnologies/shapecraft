/**
 * Example: createClient() — middleware pipeline over generate()/generateStream().
 *
 * createClient() is purely additive sugar: it wraps the same generate()/
 * generateStream() you'd otherwise call directly, adding a Koa-style onion
 * middleware chain plus client-level defaults (retry/timeout/validator).
 * Existing direct calls to generate()/generateStream() are unaffected.
 */
import { createClient, loggingMiddleware, groq } from "@aviasole/shapecraft";
import type { GenerateResult, Middleware } from "@aviasole/shapecraft";

const model = groq({ model: "llama-3.3-70b-versatile" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["name", "age"],
    properties: { name: { type: "string" }, age: { type: "number" } },
  },
};

// ── Simple: built-in loggingMiddleware + client-level defaults ──────────────
const client = createClient({
  middleware: [loggingMiddleware()],
  retry: { max: 3 },
  timeoutMs: 10_000,
});

const result = await client.generate(model, schema, "Extract: Jane Doe, 28");
console.log(result.data, result.metadata);
// { name: "Jane Doe", age: 28 }  { provider: "groq", model: "llama-3.3-70b-versatile", latencyMs: 284 }

// ── Middleware ordering: outer middleware sees the request first and the
// result/error last — the same "onion" model as Koa/Express. ────────────────
const timing =
  (label: string): Middleware =>
  async (ctx, next) => {
    const t0 = Date.now();
    console.log(`${label} → ${ctx.model.id}`);
    const res = await next();
    console.log(`${label} ← done in ${Date.now() - t0}ms`);
    return res;
  };

const nested = createClient({ middleware: [timing("outer"), timing("inner")] });
await nested.generate(model, schema, "Extract: John Smith, 41");
// outer → groq:llama-3.3-70b-versatile
// inner → groq:llama-3.3-70b-versatile
// inner ← done in 284ms
// outer ← done in 284ms

// ── A middleware that never calls next() short-circuits the real call —
// the classic shape for a cache layer. ───────────────────────────────────────
const cache = new Map<string, GenerateResult<unknown>>();

const cachingMiddleware: Middleware = async (ctx, next) => {
  const key = `${ctx.model.id}:${ctx.prompt}`;
  const hit = cache.get(key);
  if (hit) {
    console.log("cache hit — skipping the real call entirely");
    return hit;
  }
  const result = await next();
  cache.set(key, result);
  return result;
};

const cachedClient = createClient({ middleware: [cachingMiddleware] });
await cachedClient.generate(model, schema, "Extract: Jane Doe, 28"); // real call, populates cache
await cachedClient.generate(model, schema, "Extract: Jane Doe, 28"); // cache hit, model never called
