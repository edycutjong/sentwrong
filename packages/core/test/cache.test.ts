import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CachedNansenClient, MemoryCache, cacheKey } from "../src/cache.js";

// A footgun fix: a real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — every
// test below builds its own CachedNansenClient without an explicit `offline` option, so CachedNansenClient falls
// back to reading the ambient env directly; neutralized here around each test, then restored.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

const KEY = "nsn_test_key_0000000000000000000000";
function cached(routes: () => unknown, opts: Partial<ConstructorParameters<typeof CachedNansenClient>[1]> = {}) {
  let hits = 0;
  const fetchImpl: typeof fetch = async () => { hits++; return new Response(JSON.stringify(routes()), { status: 200 }); };
  const store = new MemoryCache();
  const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store, ...opts });
  return { c, store, network: () => hits };
}

describe("CachedNansenClient", () => {
  it("cacheKey is stable across body key order", () => {
    expect(cacheKey("profiler/address/counterparties", { a: 1, b: 2 })).toBe(cacheKey("profiler/address/counterparties", { b: 2, a: 1 }));
    expect(cacheKey("profiler/address/counterparties", { a: 1 })).not.toBe(cacheKey("profiler/address/related-wallets", { a: 1 }));
  });
  it("second identical call is served from cache at 0 credits with the same response hash", async () => {
    const { c, network } = cached(() => ({ data: [1] }));
    await c.post("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1" });
    await c.post("profiler/address/counterparties", { token_address: "0x1", chain: "ethereum" });
    expect(network()).toBe(1);
    expect(c.calls.map((x) => x.cached)).toEqual([false, true]);
    expect(c.calls[0].responseHash).toBe(c.calls[1].responseHash);
    expect(c.creditsSpent).toBe(5);
    expect(c.oldestHit).toBeDefined();
  });
  it("expired entries are refetched", async () => {
    const { c, store, network } = cached(() => ({ v: 1 }), { ttlMs: 1 });
    await c.post("profiler/address/counterparties", { a: 1 });
    const key = cacheKey("profiler/address/counterparties", { a: 1 });
    store.set(key, { ...store.get(key)!, storedAt: new Date(Date.now() - 10_000).toISOString() });
    await c.post("profiler/address/counterparties", { a: 1 });
    expect(network()).toBe(2);
  });
  it("offline mode serves stale entries and errors on a miss instead of touching the network", async () => {
    const { c, store, network } = cached(() => ({ v: 1 }));
    await c.post("profiler/address/counterparties", { a: 1 });
    const key = cacheKey("profiler/address/counterparties", { a: 1 });
    store.set(key, { ...store.get(key)!, storedAt: "2000-01-01T00:00:00.000Z" });
    const off = new CachedNansenClient(KEY, { fetchImpl: async () => { throw new Error("network!"); }, store, offline: true });
    expect(await off.post("profiler/address/counterparties", { a: 1 })).toEqual({ v: 1 });
    await expect(off.post("profiler/address/counterparties", { a: 2 })).rejects.toThrow(/NANSEN_OFFLINE/);
    expect(network()).toBe(1);
  });
});

describe("review fixes (2026-09-16)", () => {
  it("REGRESSION (cache key): two counterparties pages with different per_page collided on one key — nested body fields are part of the key, key order is not", () => {
    const a = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 20 } });
    const b = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 100 } });
    const c = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { per_page: 20, page: 1 } });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
  it("REGRESSION (--no-cache): ttlMs 0 still served a fresh cached entry — it bypasses reads, and what it writes does not poison the next cached read", async () => {
    const store = new MemoryCache();
    let hits = 0;
    const fetchImpl: typeof fetch = async () => { hits++; return new Response('{"v":1}', { status: 200 }); };
    const normal = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await normal.post("profiler/address/counterparties", { a: 1 });
    const bypass = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store, ttlMs: 0 });
    await bypass.post("profiler/address/counterparties", { a: 1 });
    expect(hits).toBe(2);
    expect(bypass.calls[0].cached).toBe(false);
    // and the entry it wrote does not poison the next normal read
    const again = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await again.post("profiler/address/counterparties", { a: 1 });
    expect(hits).toBe(2);
    expect(again.calls[0].cached).toBe(true);
  });
});

describe("review round 2: creditsSpent on the cached client", () => {
  it("REGRESSION (creditsSpent): a 503 was charged as a paid call — failed calls cost 0 credits", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: async () => new Response("x", { status: 503 }), rps: 1000, store });
    await expect(c.post("profiler/address/counterparties", { a: 1 }, [], { retries: 0 })).rejects.toThrow();
    expect(c.calls[0]).toMatchObject({ ok: false, credits: 0 });
    expect(c.creditsSpent).toBe(0);
  });
});

describe("4xx rejections are cached and replayed (burn addresses are deterministic)", () => {
  it("a 422 is stored with its status and replayed as the same NansenError at 0 credits, offline too", async () => {
    const store = new MemoryCache();
    let hits = 0;
    const fetchImpl: typeof fetch = async () => { hits++; return new Response('{"error":"Burn address not allowed"}', { status: 422 }); };
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await expect(c.post("profiler/address/transactions", { address: "0xdead" })).rejects.toThrow(/HTTP 422/);
    const off = new CachedNansenClient(KEY, { fetchImpl: async () => { throw new Error("network!"); }, store, offline: true });
    await expect(off.post("profiler/address/transactions", { address: "0xdead" })).rejects.toThrow(/HTTP 422.*Burn address/);
    expect(hits).toBe(1);
    expect(off.calls[0]).toMatchObject({ cached: true, ok: false, status: 422, credits: 0 });
  });
  it("429 and 5xx are never cached", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: async () => new Response("slow", { status: 429 }), rps: 1000, store });
    await expect(c.post("profiler/address/transactions", { a: 1 })).rejects.toThrow();
    expect(store.get(cacheKey("profiler/address/transactions", { a: 1 }))).toBeUndefined();
  });
});

describe("audit 2026-09-23: what the cache keeps", () => {
  it("REGRESSION (account errors cached): a 403 (key/credits) was replayed for 24 h after the account was fixed — only 400 and 422 are cached", async () => {
    const store = new MemoryCache();
    let status = 403;
    const fetchImpl: typeof fetch = async () => (status === 200 ? new Response('{"data":[]}', { status: 200 }) : new Response('{"error":"Insufficient credits"}', { status }));
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    for (const s of [401, 402, 403, 404]) {
      status = s;
      await expect(c.post("profiler/address/transactions", { a: s })).rejects.toThrow(new RegExp(`HTTP ${s}`));
      expect(store.get(cacheKey("profiler/address/transactions", { a: s }))).toBeUndefined();
    }
    status = 400;
    await expect(c.post("profiler/address/transactions", { a: 400 })).rejects.toThrow(/HTTP 400/);
    expect(store.get(cacheKey("profiler/address/transactions", { a: 400 }))?.status).toBe(400);
    // the account is fixed: the next call goes to the network and succeeds
    status = 200;
    expect(await c.post("profiler/address/transactions", { a: 403 })).toEqual({ data: [] });
  });
  it("REGRESSION (non-JSON 200): a proxy's HTML page was recorded ok AND failed, and cached for 24 h — it is one failed row, never stored", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: async () => new Response("<html>Bad gateway</html>", { status: 200 }), rps: 1000, store });
    await expect(c.post("profiler/address/transactions", { a: 1 })).rejects.toThrow(/non-JSON response/);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: false, credits: 0 });
    expect(store.get(cacheKey("profiler/address/transactions", { a: 1 }))).toBeUndefined();
  });
  it("MemoryCache(max) evicts the oldest entry first; re-setting a key refreshes its place", () => {
    const m = new MemoryCache(2);
    const e = (text: string) => ({ storedAt: "2026-09-23T00:00:00Z", ttlMs: 1, endpoint: "x", body: {}, text });
    m.set("a", e("1"));
    m.set("b", e("2"));
    m.set("a", e("1b")); // a is now the newest
    m.set("c", e("3")); // evicts b
    expect(Object.keys(m.entries())).toEqual(["a", "c"]);
    expect(m.get("a")?.text).toBe("1b");
  });
});
