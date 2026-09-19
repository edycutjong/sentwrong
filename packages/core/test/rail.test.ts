/**
 * The Nansen call rail's state (apps/web/lib/rail.ts): pending rows open on `start`, fill on `end` with the real
 * Call, totals equal the drawer's, the session caps at RAIL_CAP, and no request body ever reaches the param line.
 */
import { describe, it, expect } from "vitest";
import type { Call } from "../src/index.js";
import { readFixture } from "../src/fixtures.js";
import {
  EMPTY_RAIL,
  RAIL_CAP,
  beginRun,
  startCall,
  endCall,
  finishRun,
  failRun,
  seedRun,
  totalsOf,
  statusOf,
  paramSummary,
  hashCell,
  creditsCell,
  msCell,
  runLabel,
} from "../../../apps/web/lib/rail.js";

const HERO = "fixtures/0xe460774c849089ee3edf0fb06da14c066caabbef.json";

const call = (over: Partial<Call> = {}): Call => ({
  endpoint: "profiler/address/transactions",
  body: { address: "0xe460774c849089ee3edf0fb06da14c066caabbef", chain: "ethereum", date: { from: "2026-09-02", to: "2026-09-16" }, pagination: { page: 1, per_page: 100 } },
  credits: 1,
  ms: 412,
  cached: false,
  status: 200,
  fieldsUsed: ["transactions[]"],
  responseHash: "a91f0000cafe",
  attempts: 1,
  totalMs: 412,
  ok: true,
  ...over,
});

describe("rail — a run in flight", () => {
  it("start opens a pending row; the matching end fills it with the same Call object; the verdict stamps the run", () => {
    const begun = beginRun(EMPTY_RAIL, runLabel("0xe460774c849089ee3edf0fb06da14c066caabbef", "ethereum"), "live", 1000);
    let s = startCall(begun.state, begun.run, { seq: 1, endpoint: "search/general", body: { search_query: "0xabc" } }, 1001);
    s = startCall(s, begun.run, { seq: 2, endpoint: "profiler/address/transactions", body: {} }, 1002);
    expect(s.rows.map(statusOf)).toEqual(["pending", "pending"]);
    expect(totalsOf(s, 1500)).toEqual({ calls: 0, credits: 0, ms: 500, pending: 2 });
    const c = call({ endpoint: "profiler/address/transactions" });
    s = endCall(s, begun.run, 2, c, 1400);
    expect(s.rows[1].call).toBe(c);
    expect(s.rows.map(statusOf)).toEqual(["pending", "live"]);
    s = endCall(s, begun.run, 1, call({ endpoint: "search/general", credits: 0, cached: true }), 1450);
    expect(statusOf(s.rows[0])).toBe("cached");
    s = finishRun(s, begun.run, 3900, "3ea6cfcd752bdeadbeef");
    // once the verdict lands, the clock is the verdict's own wall time — the drawer's number — not the ticking one
    expect(totalsOf(s, 99_999)).toEqual({ calls: 2, credits: 1, ms: 3900, pending: 0 });
    expect(s.runs[0].hash).toBe("3ea6cfcd752bdeadbeef");
  });

  it("an end without a start still lands as its own row (a server-rendered permalink)", () => {
    const begun = beginRun(EMPTY_RAIL, "x", "server", 0);
    const s = endCall(begun.state, begun.run, 7, call(), 0);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].endpoint).toBe("profiler/address/transactions");
    expect(statusOf(s.rows[0])).toBe("live");
  });

  it("a broken stream closes the run's pending rows as failed, labelled with the error — nothing pulses forever", () => {
    const begun = beginRun(EMPTY_RAIL, "x", "live", 0);
    let s = startCall(begun.state, begun.run, { seq: 1, endpoint: "search/general", body: {} }, 0);
    s = endCall(s, begun.run, 1, call({ endpoint: "search/general" }), 0);
    s = startCall(s, begun.run, { seq: 2, endpoint: "profiler/address/first-funder", body: {} }, 0);
    s = failRun(s, begun.run, "the stream ended");
    expect(statusOf(s.rows[0])).toBe("live");
    expect(statusOf(s.rows[1])).toBe("error");
    expect(s.rows[1].call?.error).toBe("the stream ended");
    expect(s.rows[1].call?.credits).toBe(0);
    expect(s.runs[0].error).toBe("the stream ended");
    expect(totalsOf(s, 0).pending).toBe(0);
  });

  it("a run that fails before its first call keeps its header past the cap (the error line must stay visible)", () => {
    let s = EMPTY_RAIL;
    const a = beginRun(s, "a", "live", 0);
    s = a.state;
    for (let i = 1; i <= RAIL_CAP; i++) s = endCall(s, a.run, i, call(), 0);
    const b = beginRun(s, "b", "live", 0);
    s = failRun(b.state, b.run, "NANSEN_API_KEY is not set on the server");
    expect(s.runs.map((r) => r.label)).toEqual(["a", "b"]);
    const c = beginRun(s, "c", "live", 0);
    s = startCall(c.state, c.run, { seq: 1, endpoint: "search/general", body: {} }, 0);
    // a's oldest row dropped; b (no rows, not newest) goes with it; c is newest and has a row
    expect(s.rows).toHaveLength(RAIL_CAP);
    expect(s.runs.map((r) => r.label)).toEqual(["a", "c"]);
  });

  it("a 422 (burn address) is Nansen's answer, not a failure: it is not painted as an error", () => {
    expect(statusOf({ call: call({ ok: false, status: 422, credits: 0, error: "Burn address not allowed" }) })).toBe("live");
    expect(statusOf({ call: call({ ok: false, status: 500, credits: 0 }) })).toBe("error");
    expect(statusOf({ call: call({ ok: false, status: 0, credits: 0, error: "timeout" }) })).toBe("error");
  });
});

describe("rail — the recorded example and the session", () => {
  it("seeds from the hero fixture's replayed provenance: every row cached, 0 credits, the same count and hash as the verdict", () => {
    const f = readFixture(HERO);
    const s = seedRun(EMPTY_RAIL, runLabel(f.address, f.verdict.chain), "replayed", f.verdict.provenance, 0, 0, f.verdict.hash);
    expect(s.rows).toHaveLength(f.verdict.calls);
    expect(s.rows.every((r) => statusOf(r) === "cached")).toBe(true);
    expect(totalsOf(s, 0)).toEqual({ calls: f.verdict.calls, credits: 0, ms: 0, pending: 0 });
    expect(s.runs[0]).toMatchObject({ origin: "replayed", hash: f.verdict.hash });
    expect(creditsCell(s.rows[0].call, true)).toBe("0 cr · replayed");
  });

  it("accumulates across runs and drops the oldest rows (and their run header) past the cap", () => {
    let s = EMPTY_RAIL;
    for (let run = 0; run < 3; run++) {
      const b = beginRun(s, `run ${run}`, "live", run);
      s = b.state;
      for (let i = 1; i <= 100; i++) s = endCall(s, b.run, i, call(), run);
    }
    expect(s.rows).toHaveLength(RAIL_CAP);
    expect(s.runs.map((r) => r.label)).toEqual(["run 1", "run 2"]);
    expect(totalsOf(s, 0).calls).toBe(RAIL_CAP);
    // run ids keep climbing — never reused within a session
    expect(s.next).toBe(4);
  });
});

describe("rail — cells", () => {
  it("summarises a body as address · chain · window · page size, never the body itself", () => {
    const p = paramSummary("profiler/address/transactions", call().body);
    expect(p).toBe("0xe460…bbef · ethereum · 14 d · top 100");
    expect(p).not.toContain("pagination");
    expect(
      paramSummary("profiler/address/counterparties", {
        address: "0x000000000000000000000000000000000000dead",
        chain: "ethereum",
        date: { from: "2015-07-30", to: "2030-01-01" },
        pagination: { per_page: 20 },
      }),
    ).toBe("0x0000…dead · ethereum · all time · top 20");
    expect(paramSummary("search/general", { search_query: "0x000000000000000000000000000000000000dead", result_type: "any", limit: 10 })).toBe("“0x0000…dead”");
    expect(paramSummary("transaction-with-token-transfer-lookup", { chain: "ethereum", transaction_hash: "0x00699c03ebc448291c5fe21e969a7562abbefd84f27580c0d58135b01cdfd384" })).toBe(
      "tx 0x0069…d384 · ethereum",
    );
    expect(paramSummary("profiler/address/related-wallets", { address: "0xe460774c849089ee3edf0fb06da14c066caabbef", chain: "ethereum", pagination: { page: 1, per_page: 50 } })).toBe(
      "0xe460…bbef · ethereum",
    );
    expect(paramSummary("profiler/address/first-funder", { address: "0xe460774c849089ee3edf0fb06da14c066caabbef", chain: "all" })).toBe("0xe460…bbef · all");
  });

  it("prints the short response hash for a good call, the HTTP status or error for a bad one, ellipses while pending", () => {
    expect(hashCell(undefined)).toBe("…");
    expect(hashCell(call())).toBe("a91f0000");
    expect(hashCell(call({ ok: false, status: 422 }))).toBe("HTTP 422");
    expect(hashCell(call({ ok: false, status: 0, error: "timeout" }))).toBe("timeout");
    expect(hashCell(call({ ok: false, status: 0, error: undefined }))).toBe("failed");
    expect(hashCell(call({ responseHash: "" }))).toBe("—");
  });

  it("credits and latency cells: live cost, `0 cr · cached`, `0 cr · replayed`, retries shown, failures show total time", () => {
    expect(creditsCell(undefined, false)).toBe("…");
    expect(creditsCell(call({ credits: 5 }), false)).toBe("5 cr");
    expect(creditsCell(call({ cached: true, credits: 0 }), false)).toBe("0 cr · cached");
    expect(msCell(undefined)).toBe("");
    expect(msCell(call())).toBe("412 ms");
    expect(msCell(call({ attempts: 2 }))).toBe("412 ms ×2");
    expect(msCell(call({ cached: true }))).toBe("0 ms");
    expect(msCell(call({ ok: false, totalMs: 8000 }))).toBe("8000 ms");
    expect(msCell(call({ ok: false, totalMs: 0 }))).toBe("");
  });

  it("labels a run by short address, chain and sender", () => {
    expect(runLabel("0xe460774c849089ee3edf0fb06da14c066caabbef", "base", "0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5")).toBe("0xe460…bbef · base · from 0xb0ae…03b5");
  });
});
