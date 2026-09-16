import { describe, it, expect } from "vitest";
import { CachedNansenClient, MemoryCache, cacheKey } from "../src/cache.js";

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
  it("F1: nested bodies with different pagination get different keys", () => {
    const a = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 20 } });
    const b = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 100 } });
    const c = cacheKey("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1", pagination: { per_page: 20, page: 1 } });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
  it("F2: ttlMs 0 (--no-cache) bypasses reads even when a fresh entry exists", async () => {
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
  it("R2-2: failed calls are not charged", async () => {
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
