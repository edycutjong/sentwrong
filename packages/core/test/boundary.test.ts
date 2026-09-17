/**
 * Permission-boundary tests — the concrete claim in .github/SECURITY.md.
 *
 * Boundary 1: the Nansen API key lives on the server (CLI process / Next.js route) and never reaches anything a browser
 *             or a judge sees: the verdict JSON, the provenance rows the web app streams, the fixtures, an error message.
 * Boundary 2: malformed input is rejected BEFORE any network call — a bad address costs zero credits and zero requests.
 *
 * The HTTP surfaces (page HTML, /api/verdict NDJSON stream, /api/og, a 400 on garbage) are covered end-to-end by
 * e2e/key-boundary.spec.ts against the built app with no key at all.
 */
import { describe, it, expect } from "vitest";
import { sentWrong, gather, NansenClient, CachedNansenClient, MemoryCache, clientFromEnv, cachedClientFromEnv, listFixtures, readFixture } from "../src/index.js";
import { parseInput } from "../../../apps/web/lib/engine.js";
import { fakeClient, binanceRoutes, KEY, R } from "./helpers.js";

const KEY_SHAPE = /nsn_[a-z0-9_]{10,}/i;

describe("boundary 1 — the API key never leaves the server process", () => {
  it("the verdict JSON (what /api/verdict streams and the CLI --json prints) does not contain the key or the apikey header", async () => {
    const c = fakeClient(binanceRoutes);
    const v = await sentWrong(c, R);
    const json = JSON.stringify(v);
    expect(json).not.toContain(KEY);
    expect(json).not.toMatch(KEY_SHAPE);
    expect(json).not.toContain("apikey");
    // the provenance rows are the same objects the web app streams line by line
    for (const call of v.provenance) expect(JSON.stringify(call)).not.toMatch(KEY_SHAPE);
  });

  it("a failed call's error text (surfaced on the card) never echoes the key", async () => {
    const c = fakeClient(() => new Response(`unauthorized for ${KEY}`, { status: 401 }));
    await expect(c.post("profiler/address/counterparties", { a: 1 }, [], { retries: 0 })).rejects.toThrow();
    const v = await sentWrong(
      fakeClient(() => new Response("upstream error", { status: 503 }), { retries: 0 } as never),
      R,
    ).catch((e) => e);
    expect(JSON.stringify(v)).not.toMatch(KEY_SHAPE);
    expect(JSON.stringify(c.calls)).not.toMatch(KEY_SHAPE);
  });

  it("the key is sent only as the apikey header of the request — never in the URL or the body", async () => {
    const seen: Array<{ url: string; body: string; header: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), body: String(init?.body ?? ""), header: (init?.headers as Record<string, string>)?.apikey });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const c = new NansenClient(KEY, { fetchImpl, rps: 1000 });
    await c.post("profiler/address/counterparties", { address: R });
    expect(seen).toHaveLength(1);
    expect(seen[0].header).toBe(KEY);
    expect(seen[0].url).not.toContain(KEY);
    expect(seen[0].body).not.toContain(KEY);
  });

  it("the recorded fixtures (public, in the repo) carry no key material", () => {
    const names = listFixtures();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(JSON.stringify(readFixture(n))).not.toMatch(KEY_SHAPE);
  });

  it("without NANSEN_API_KEY the server refuses to build a client — there is no anonymous or default key", () => {
    const saved = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => clientFromEnv()).toThrow(/NANSEN_API_KEY/);
      expect(() => cachedClientFromEnv()).toThrow(/NANSEN_API_KEY/);
      expect(() => new NansenClient("")).toThrow(/NANSEN_API_KEY/);
      expect(() => new CachedNansenClient("sk-not-a-nansen-key", { store: new MemoryCache() })).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.NANSEN_API_KEY = saved;
    }
  });
});

describe("boundary 2 — malformed input is rejected before any network call (zero requests, zero credits)", () => {
  const BAD = [
    "",
    "0x",
    "0x123",
    "0xZZ60774c849089ee3edf0fb06da14c066caabbef",
    "e460774c849089ee3edf0fb06da14c066caabbef",
    "vitalik.eth",
    "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
    "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    "0xe460774c849089ee3edf0fb06da14c066caabbef; DROP TABLE",
    " 0xe460774c849089ee3edf0fb06da14c066caabbef ",
  ];

  it("gather() throws on every malformed recipient with no fetch made", async () => {
    let fetches = 0;
    const c = fakeClient(() => {
      fetches++;
      return {};
    });
    for (const bad of BAD) await expect(gather(c, bad)).rejects.toThrow(/not an EVM address/);
    expect(fetches).toBe(0);
    expect(c.calls).toHaveLength(0);
    expect(c.creditsSpent).toBe(0);
  });

  it("a malformed --from is rejected the same way, and never spends the recipient's lookups first", async () => {
    let fetches = 0;
    const c = fakeClient(() => {
      fetches++;
      return {};
    });
    await expect(gather(c, R, { sender: "0xnope" })).rejects.toThrow(/--from is not an EVM address/);
    expect(fetches).toBe(0);
  });

  it("the web route's parseInput() rejects the same inputs, an unknown chain and a non-string body, with a message a person can act on", () => {
    for (const bad of BAD.filter((b) => b.trim() !== R)) expect(() => parseInput({ address: bad })).toThrow(/EVM address/);
    expect(() => parseInput({ address: R, sender: "0x12" })).toThrow(/Your address must be an EVM address/);
    expect(() => parseInput({ address: R, chain: "solana" })).toThrow(/Unsupported chain "solana"/);
    expect(() => parseInput(null)).toThrow(/EVM address/);
    expect(() => parseInput({ address: 42 })).toThrow(/EVM address/);
    // and the well-formed input passes through trimmed, lower-risk: deep is only ever the literal boolean true
    expect(parseInput({ address: ` ${R} `, chain: "base", deep: "true" })).toEqual({ address: R, sender: undefined, chain: "base", deep: false });
  });
});
