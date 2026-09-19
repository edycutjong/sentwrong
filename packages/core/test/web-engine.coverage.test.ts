/**
 * Coverage-closing tests for apps/web/lib/engine.ts (the server-side engine the /api/verdict route calls).
 * No network: global fetch is stubbed; the module-level cache store is exercised with a temp-dir cwd so nothing
 * is ever written under the real repo. The module is reset & reimported per test that needs to observe its
 * VERCEL-dependent top-level `store` choice (DiskCache vs MemoryCache), since that ternary runs once at import time.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInput, TTL_MS } from "../../../apps/web/lib/engine.js";
import type { CallEvent } from "../src/index.js";
import { R, SENDER, KEY, search, txs, cps, related, noFunder } from "./helpers.js";

const ENGINE = "../../../apps/web/lib/engine.js";

let tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NANSEN_API_KEY;
  delete process.env.VERCEL;
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

/** Reimports engine.ts with a temp cwd (so DiskCache never touches the real repo) and a chosen VERCEL state. */
async function freshEngine(vercel: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "sentwrong-engine-"));
  tempDirs.push(dir);
  vi.resetModules();
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  if (vercel) process.env.VERCEL = "1";
  else delete process.env.VERCEL;
  const mod = await import(ENGINE);
  return { mod: mod as typeof import("../../../apps/web/lib/engine.js"), dir };
}

/** A history-free wallet: every profiler lookup comes back empty-but-ok, no token hit, no tx lookups needed. */
function emptyRouteFor(endpoint: string): unknown {
  if (endpoint === "search/general") return search();
  if (endpoint === "profiler/address/transactions") return txs([]);
  if (endpoint === "profiler/address/related-wallets") return related([]);
  if (endpoint === "profiler/address/first-funder") return noFunder();
  if (endpoint === "profiler/address/counterparties") return cps([]);
  throw new Error("unexpected endpoint in test router: " + endpoint);
}

/** Stubs global fetch (engine.ts's client() never passes fetchImpl, so it rides the global) with staggered
 *  per-call latency — call #0 fastest, call #5 slowest — so a real setInterval poller sees both a tick with
 *  nothing new yet and ticks where calls landed, without hand-choreographing fake timers. */
function stubStaggeredFetch() {
  let n = 0;
  const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const i = n++;
    await new Promise((r) => setTimeout(r, i * 90));
    const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
    const body = emptyRouteFor(endpoint);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);
  return fetchImpl;
}

describe("engine.ts — parseInput", () => {
  it("passes through a well-formed sender without throwing (sender && EVM_ADDRESS.test(sender) both true)", () => {
    expect(parseInput({ address: R, sender: SENDER })).toEqual({ address: R, sender: SENDER, chain: "ethereum", deep: false });
  });

  it("TTL_MS is the 24h cache lifetime shared with the CLI", () => {
    expect(TTL_MS).toBe(24 * 3600 * 1000);
  });
});

describe("engine.ts — client()", () => {
  it("refuses to build a client without NANSEN_API_KEY on the server", async () => {
    const { mod } = await freshEngine(false);
    delete process.env.NANSEN_API_KEY;
    expect(() => mod.client()).toThrow(/NANSEN_API_KEY is not set on the server/);
  });

  it("builds a CachedNansenClient using a DiskCache when not on Vercel (local/dev, cache survives restarts)", async () => {
    const { mod, dir } = await freshEngine(false);
    process.env.NANSEN_API_KEY = KEY;
    const c = mod.client();
    expect(c.constructor.name).toBe("CachedNansenClient");
    // touching the client's cache path proves DiskCache (not MemoryCache) was wired in: the .cache dir gets created
    // eagerly by DiskCache's constructor under the mocked cwd, never the real repo.
    expect(existsSync(join(dir, ".cache"))).toBe(true);
  });

  it("builds a CachedNansenClient using a MemoryCache on Vercel (no durable disk across cold starts)", async () => {
    const { mod, dir } = await freshEngine(true);
    process.env.NANSEN_API_KEY = KEY;
    const c = mod.client();
    expect(c.constructor.name).toBe("CachedNansenClient");
    // no disk cache directory should ever be created on the Vercel branch
    expect(existsSync(join(dir, ".cache"))).toBe(false);
  });
});

describe("engine.ts — verdictFor()", () => {
  it("resolves a Verdict with no observer", async () => {
    const { mod } = await freshEngine(false);
    process.env.NANSEN_API_KEY = KEY;
    stubStaggeredFetch();
    const v = await mod.verdictFor({ address: R });
    expect(v.address).toBe(R.toLowerCase());
    expect(v.calls).toBeGreaterThan(0);
  }, 15000);

  it("streams every call twice — `start` before the network is touched, `end` with the very Call object provenance holds", async () => {
    const { mod } = await freshEngine(true);
    process.env.NANSEN_API_KEY = KEY;
    stubStaggeredFetch();
    const events: CallEvent[] = [];
    const v = await mod.verdictFor({ address: R }, (e) => events.push(e));
    const starts = events.filter((e) => e.type === "start");
    const ends = events.filter((e) => e.type === "end");
    expect(starts.length).toBe(v.calls);
    expect(ends.length).toBe(v.calls);
    // every end pairs with exactly one earlier start of the same endpoint
    for (const e of ends) {
      if (e.type !== "end") continue;
      const i = events.findIndex((x) => x.type === "start" && x.start.seq === e.seq);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(events.indexOf(e));
      expect((events[i] as { start: { endpoint: string } }).start.endpoint).toBe(e.call.endpoint);
    }
    // the rail prints the same objects the drawer prints: identity, not a copy
    const provenance = new Set(v.provenance);
    for (const e of ends) if (e.type === "end") expect(provenance.has(e.call)).toBe(true);
    // the first start precedes the first end — a pending row can exist before any call lands
    expect(events[0].type).toBe("start");
  }, 15000);

  it("an observer that throws never breaks the verdict", async () => {
    const { mod } = await freshEngine(false);
    process.env.NANSEN_API_KEY = KEY;
    stubStaggeredFetch();
    const v = await mod.verdictFor({ address: R }, () => {
      throw new Error("observer bug");
    });
    expect(v.calls).toBeGreaterThan(0);
  }, 15000);

  it("rejects before any fetch when the address fails validation inside gather()", async () => {
    const { mod } = await freshEngine(false);
    process.env.NANSEN_API_KEY = KEY;
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);
    const events: CallEvent[] = [];
    await expect(mod.verdictFor({ address: "0xnotaddress" }, (e) => events.push(e))).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
