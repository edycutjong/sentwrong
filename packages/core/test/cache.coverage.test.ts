import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, MemoryCache, CachedNansenClient, cachedClientFromEnv, cacheKey } from "../src/cache.js";

const KEY = "nsn_test_key_0000000000000000000000";

// Every test that touches process.cwd() or process.env restores it here, even on failure.
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function withTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sentwrong-cache-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function withCwd(dir: string) {
  const prev = process.cwd();
  process.chdir(dir);
  cleanups.push(() => process.chdir(prev));
}

function withEnv(key: string, value: string | undefined) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  cleanups.push(() => { if (prev === undefined) delete process.env[key]; else process.env[key] = prev; });
}

describe("DiskCache", () => {
  it("set() then get() round-trips an entry from an explicit directory", () => {
    const dir = withTmpDir();
    const disk = new DiskCache(dir);
    const entry = { storedAt: "2026-09-16T00:00:00.000Z", ttlMs: 1000, endpoint: "profiler/address/counterparties", body: { a: 1 }, text: '{"v":1}' };
    disk.set("abc123", entry);
    expect(disk.get("abc123")).toEqual(entry);
  });

  it("get() returns undefined for a key that was never written", () => {
    const dir = withTmpDir();
    const disk = new DiskCache(dir);
    expect(disk.get("never-set")).toBeUndefined();
  });

  it("get() returns undefined (not a throw) when the on-disk file holds invalid JSON", () => {
    const dir = withTmpDir();
    const disk = new DiskCache(dir);
    // written directly, bypassing set(), to simulate a truncated/corrupt cache file
    writeFileSync(join(dir, "corrupt.json"), "{not valid json");
    expect(disk.get("corrupt")).toBeUndefined();
  });

  it("with no directory given, defaults to .cache under the current working directory", () => {
    const dir = withTmpDir();
    withCwd(dir);
    new DiskCache();
    expect(existsSync(join(dir, ".cache"))).toBe(true);
  });
});

describe("CachedNansenClient without an explicit store", () => {
  it("falls back to a DiskCache rooted at the current working directory", async () => {
    const dir = withTmpDir();
    withCwd(dir);
    let hits = 0;
    const fetchImpl: typeof fetch = async () => { hits++; return new Response('{"v":1}', { status: 200 }); };
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000 });
    const result = await c.post("profiler/address/counterparties", { a: 1 });
    expect(result).toEqual({ v: 1 });
    expect(hits).toBe(1);
    // the fallback DiskCache actually wrote through to disk at the expected key
    const key = cacheKey("profiler/address/counterparties", { a: 1 });
    expect(existsSync(join(dir, ".cache", `${key}.json`))).toBe(true);
  });
});

describe("MemoryCache.entries()", () => {
  it("returns everything stored, keyed by cache key, in insertion order (used by scripts/seed.ts)", () => {
    const store = new MemoryCache();
    const e1 = { storedAt: "2026-09-16T00:00:00.000Z", ttlMs: 1000, endpoint: "profiler/address/counterparties", body: { a: 1 }, text: '{"v":1}' };
    const e2 = { storedAt: "2026-09-16T00:00:01.000Z", ttlMs: 1000, endpoint: "profiler/address/transactions", body: { a: 2 }, text: '{"v":2}' };
    store.set("k1", e1);
    store.set("k2", e2);
    expect(store.entries()).toEqual({ k1: e1, k2: e2 });
  });
});

describe("credits fall back to 1 for an endpoint absent from the CREDITS table", () => {
  it("a fresh (non-cached) call to an unlisted endpoint records credits: 1", async () => {
    const store = new MemoryCache();
    const fetchImpl: typeof fetch = async () => new Response('{"v":1}', { status: 200 });
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await c.post("some/unlisted-endpoint", { a: 1 });
    expect(c.calls[0]).toMatchObject({ cached: false, credits: 1 });
  });
});

describe("cachedClientFromEnv", () => {
  it("builds a client from NANSEN_API_KEY in the environment", () => {
    withEnv("NANSEN_API_KEY", KEY);
    const c = cachedClientFromEnv({ store: { get: () => undefined, set: () => {} } });
    expect(c).toBeInstanceOf(CachedNansenClient);
  });

  it("throws (via the underlying client's own validation) when NANSEN_API_KEY is unset", () => {
    withEnv("NANSEN_API_KEY", undefined);
    expect(() => cachedClientFromEnv()).toThrow(/NANSEN_API_KEY missing or malformed/);
  });
});
