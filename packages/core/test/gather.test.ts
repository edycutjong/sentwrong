import { describe, it, expect } from "vitest";
import { gather } from "../src/lookups.js";
import { sentWrong, rowsFor, findTransfer } from "../src/verdict.js";
import { CachedNansenClient, MemoryCache } from "../src/cache.js";
import { fakeClient, binanceRoutes, search, txs, txRow, cps, related, noFunder, lookup, transfer, labels, R, HOT, USER, SENDER, KEY, binanceDeposit, ok } from "./helpers.js";

describe("gather() over the wire", () => {
  it("rejects a malformed address before any call", async () => {
    const c = fakeClient(() => { throw new Error("must not be called"); });
    await expect(gather(c, "0xd8da6bf26964af9d7eed9e03e4415d37aa96045")).rejects.toThrow(/not an EVM address/);
    await expect(gather(c, R, { sender: "abc" })).rejects.toThrow(/--from is not an EVM address/);
    expect(c.calls).toHaveLength(0);
  });
  it("the hero makes exactly the documented calls: search, 4 profiler lookups, the all-time transactions page, 2 outbound + 1 inbound + 1 funding lookup = 10 calls, 13 credits", async () => {
    const c = fakeClient(binanceRoutes);
    const l = await gather(c, R, { now: Date.parse("2026-09-16T14:00:00Z") });
    expect(c.calls.map((x) => x.endpoint)).toEqual([
      "search/general", "profiler/address/transactions", "profiler/address/related-wallets", "profiler/address/first-funder",
      "profiler/address/transactions", "profiler/address/counterparties",
      "transaction-with-token-transfer-lookup", "transaction-with-token-transfer-lookup", "transaction-with-token-transfer-lookup", "transaction-with-token-transfer-lookup",
    ]);
    expect(c.creditsSpent).toBe(13);
    expect(c.calls[1].body.date).toEqual({ from: "2026-09-02", to: "2026-09-17" }); // 14-day window from `now`
    expect(c.calls[4].body.date).toEqual({ from: "2015-07-30", to: "2030-01-01" });
    expect(c.calls[5].body.date).toEqual({ from: "2015-07-30", to: "2030-01-01" }); // counterparties all-time for a quiet address
    expect(l.transactionsWindow).toBe("all");
    expect(l.txLookups.map((x) => x.role)).toEqual(["outbound", "outbound", "inbound", "funding"]);
    expect(l.skipped).toEqual([]);
  });
  it("a token contract short-circuits after search/general: 1 call, 0 credits, the rest recorded as skipped", async () => {
    const c = fakeClient((e) => (e === "search/general" ? search([{ address: R, symbol: "USDC" }]) : (() => { throw new Error("must not be called"); })()));
    const l = await gather(c, R);
    expect(c.calls).toHaveLength(1);
    expect(c.creditsSpent).toBe(0);
    expect(l.skipped).toContain("profiler/address/transactions");
    expect(l.transactions.ok).toBe(false);
  });
  it("a busy address (14-day page full) never requests the all-time window", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => txRow({ from: R, to: USER, ts: `2026-09-1${i % 6}T00:00:${String(i % 60).padStart(2, "0")}`, hash: "0x" + String(i).padStart(64, "0") }));
    const c = fakeClient((e, body) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") { if ((body.date as { from: string }).from === "2015-07-30") throw new Error("all-time must not be requested"); return txs(rows, false); }
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      if (e === "transaction-with-token-transfer-lookup") return lookup(String(body.transaction_hash), []);
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, R, { now: Date.parse("2026-09-16T14:00:00Z") });
    expect(l.transactionsWindow).toBe("14d");
    expect(c.calls.filter((x) => x.endpoint === "profiler/address/transactions")).toHaveLength(1);
    expect(c.calls.find((x) => x.endpoint === "profiler/address/counterparties")!.body.date).toEqual({ from: "2026-09-02", to: "2026-09-17" }); // busy → 14-day counterparties too
  });
  it("a failed all-time page falls back to the 14-day page and says so", async () => {
    const c = fakeClient((e, body) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") return (body.date as { from: string }).from === "2015-07-30" ? new Response("slow", { status: 504 }) : txs([txRow({ from: R, to: USER })]);
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      if (e === "transaction-with-token-transfer-lookup") return lookup(String(body.transaction_hash), []);
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, R);
    expect(l.transactions.ok && l.transactions.data.data).toHaveLength(1);
    expect(l.skipped[0]).toMatch(/all-time .* using the 14-day page/);
  });
  it("a burn address (422) skips the transaction lookups", async () => {
    const c = fakeClient((e) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions" || e === "profiler/address/counterparties") return new Response('{"error":"Burn address not allowed","message":"Burn address \'0x…\' is not allowed"}', { status: 422 });
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, "0x000000000000000000000000000000000000dead");
    expect(l.txLookups).toEqual([]);
    expect(l.skipped).toEqual(["transaction-with-token-transfer-lookup (burn address)"]);
    expect(c.creditsSpent).toBe(2); // related + first-funder; the two 422s cost nothing
  });
  it("with a sender, the sender's transfer to the recipient is looked up (role from-sender) and the sender's related wallets are fetched", async () => {
    const dep = txRow({ hash: "0x" + "d".repeat(64), from: SENDER, to: R });
    const c = fakeClient((e, body) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") return txs([txRow({ hash: "0x" + "1".repeat(64), from: R, to: HOT }), dep, txRow({ from: USER, to: R, ts: "2026-09-01T00:00:00" })]);
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related(body.address === SENDER ? [{ address: R, relation: "First Funder" }] : []);
      if (e === "profiler/address/first-funder") return noFunder();
      if (e === "transaction-with-token-transfer-lookup") return lookup(String(body.transaction_hash), []);
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, R, { sender: SENDER });
    expect(l.txLookups.map((x) => x.role)).toEqual(["outbound", "from-sender"]);
    expect(l.senderRelated?.ok && l.senderRelated.data.data[0].address).toBe(R);
    expect(findTransfer(l)).toMatchObject({ hash: dep.transaction_hash, amount: 100, symbol: "USDT", from: SENDER, to: R });
  });
  it("a funding transaction on another chain is not looked up (the lookup is per chain)", async () => {
    const c = fakeClient((e) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") return txs([]);
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return { data: [{ wallet_address: R, first_funder_address: "0x91d66b38ae24292e9e12dd962bbb3aecf4ab769a", first_funder_name: "High Activity", transaction_hash: "0x" + "b".repeat(64), block_timestamp: "2025-07-22T22:52:43Z", chain: "base" }] };
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, R);
    expect(l.txLookups).toEqual([]);
  });
  it("failed lookups become ok:false entries with the error, never exceptions", async () => {
    const c = fakeClient((e) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") return new Response("upstream", { status: 503 });
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      throw new Error("unexpected " + e);
    });
    const l = await gather(c, R);
    expect(l.transactions).toMatchObject({ ok: false, status: 503 });
  });
});

describe("sentWrong() end to end", () => {
  it("returns the verdict with provenance, credits, rows and a 64-hex hash; a second run is served from cache at 0 credits with the same hash", async () => {
    const store = new MemoryCache();
    const fetchImpl: typeof fetch = async (url, init) => new Response(JSON.stringify(binanceRoutes(String(url).replace("https://api.nansen.ai/api/v1/", ""), JSON.parse(String(init?.body)))), { status: 200 });
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    const v1 = await sentWrong(c, R, { now: Date.parse("2026-09-16T14:00:00Z") });
    expect(v1.decision.route).toBe("exchange-deposit");
    expect(v1.credits).toBe(13); expect(v1.calls).toBe(10); expect(v1.cachedCalls).toBe(0);
    expect(v1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.rows[0]).toMatchObject({ address: USER, label: "High Activity" }); expect(v1.rows[0].entityLabel).toBeUndefined(); // a wealth tag is not an identity
    expect(v1.rows[1]).toMatchObject({ address: HOT, label: "Token Billionaire", entityLabel: "🏦 Binance 14 [0x28c6c0]" });
    const v2 = await sentWrong(c, R, { now: Date.parse("2026-09-16T14:00:00Z") });
    expect(v2.credits).toBe(0); expect(v2.cachedCalls).toBe(10);
    expect(v2.hash).toBe(v1.hash);
  });
  it("--deep adds the 100-credit labels call and reports agreement", async () => {
    const c = fakeClient(binanceRoutes);
    const v = await sentWrong(c, R, { deep: true });
    expect(v.credits).toBe(113);
    expect(v.deep).toMatchObject({ labels: ["Binance", "Deposit"], credits: 100, agrees: true });
  });
  it("--deep disagreement is a warning on the card, not a silent override", async () => {
    const c = fakeClient((e, b) => (e === "profiler/address/labels" ? labels([{ label: "Kraken", category: "exchange", kind: ["entity"] }]) : binanceRoutes(e, b)));
    const v = await sentWrong(c, R, { deep: true });
    expect(v.deep?.agrees).toBe(false);
    expect(v.decision.route).toBe("exchange-deposit");
    expect(v.decision.warnings.at(-1)).toMatch(/disagrees: Kraken/);
  });
  it("rowsFor merges Nansen's per-token counterparty rows per address (derived sums)", () => {
    const l = binanceDeposit({ counterparties: ok(cps([{ address: HOT, label: ["Token Billionaire"], n: 3, out: 100 }, { address: HOT, n: 2, out: 50 }, { address: USER, n: 1, in: 5 }])) });
    const rows = rowsFor(l);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ address: HOT, interactions: 5, outUsd: 150, label: "Token Billionaire" });
  });
  it("the wealth tag never overrides an entity label in the rows; an ENS name is not an entity", () => {
    const l = binanceDeposit();
    const rows = rowsFor(l);
    expect(rows.find((r) => r.address === GAS_)?.entityLabel).toBe("🏦 Binance [0x943080]");
  });
});
const GAS_ = "0x9430801ebaf509ad49202aabc5f5bc6fd8a3daf8";
