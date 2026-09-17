/**
 * Coverage-closing tests for lookups.ts (statements/branches/functions/lines → 100%).
 * These target the two paths gather.test.ts never exercises:
 *  - settle()'s catch branch for a rejection that is NOT a NansenError (a raw network/timeout failure).
 *  - splitDirection()'s `?? []` fallback when a row's tokens_sent/tokens_received is null.
 */
import { describe, it, expect } from "vitest";
import { gather, splitDirection } from "../src/lookups.js";
import type { TxRow } from "../src/nansen.js";
import { fakeClient, search, txs, cps, related, noFunder, R } from "./helpers.js";

describe("settle() — non-NansenError rejections (lookups.ts catch branch)", () => {
  it("an AbortError-named rejection (a real fetch timeout) is recorded as ok:false, error: 'timeout', status 0 — never thrown", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general") return search();
      if (endpoint === "profiler/address/transactions") return txs([]);
      if (endpoint === "profiler/address/counterparties") return cps([]);
      if (endpoint === "profiler/address/first-funder") return noFunder();
      if (endpoint === "profiler/address/related-wallets") {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        throw abort;
      }
      throw new Error("unexpected " + endpoint);
    });
    const l = await gather(c, R);
    expect(l.related).toEqual({ ok: false, error: "timeout", status: 0 });
  });

  it("a rejection that is not an Error at all (e.g. a raw string thrown by a broken fetch impl) is stringified, not thrown", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general") return search();
      if (endpoint === "profiler/address/transactions") return txs([]);
      if (endpoint === "profiler/address/counterparties") return cps([]);
      if (endpoint === "profiler/address/related-wallets") return related([]);
      if (endpoint === "profiler/address/first-funder") throw "boom-network-down";
      throw new Error("unexpected " + endpoint);
    });
    const l = await gather(c, R);
    expect(l.firstFunder).toEqual({ ok: false, error: "boom-network-down", status: 0 });
  });

  it("a generic Error (non-AbortError) rejection uses its message, not the ternary's timeout branch", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general") return search();
      if (endpoint === "profiler/address/transactions") return txs([]);
      if (endpoint === "profiler/address/counterparties") return cps([]);
      if (endpoint === "profiler/address/related-wallets") return related([]);
      if (endpoint === "profiler/address/first-funder") throw new Error("ECONNRESET");
      throw new Error("unexpected " + endpoint);
    });
    const l = await gather(c, R);
    expect(l.firstFunder).toEqual({ ok: false, error: "ECONNRESET", status: 0 });
  });
});

describe("splitDirection() — null tokens_sent/tokens_received", () => {
  it("a row with tokens_sent: null and tokens_received: null is neither outbound nor inbound (?? [] fallback)", () => {
    const row: TxRow = {
      chain: "ethereum",
      method: "transfer(address,uint256)",
      tokens_sent: null,
      tokens_received: null,
      block_timestamp: "2026-09-16T13:53:11",
      transaction_hash: "0x" + "7".repeat(64),
      source_type: "transfer",
    };
    const { outbound, inbound } = splitDirection([row], R);
    expect(outbound).toEqual([]);
    expect(inbound).toEqual([]);
  });
});
