/**
 * Coverage top-up for classify.ts — pins the remaining uncovered branches left after classify.test.ts and
 * classify.property.test.ts: nullish-coalescing fallbacks that DO fire on realistic malformed/edge inputs. Reuses the
 * builders from helpers.ts; never edits classify.test.ts.
 */
import { describe, it, expect } from "vitest";
import { classify, ownLabels, outboundDestinations, activity, outflowConcentration } from "../src/classify.js";
import type { TxRow, CounterpartyRow, CounterpartiesResponse } from "../src/nansen.js";
import { lookups, binanceDeposit, ok, txs, txRow, lookup, transfer, R, HOT, GAS, USER } from "./helpers.js";

const NOW = Date.parse("2026-09-16T14:00:00Z");

describe("transfers() tolerates a null token_transfer_array (not just a missing one)", () => {
  it("a tx lookup whose token_transfer_array is null contributes no own-label or destination", () => {
    const hash = "0x" + "a".repeat(64);
    const res = lookup(hash, [transfer(R, HOT, "🏦 Binance: Deposit [0xe46077]", "🏦 Binance 14 [0x28c6c0]")]);
    res.data[0].token_transfer_array = null;
    const l = lookups({ txLookups: [{ hash, role: "outbound", result: ok(res) }] });
    expect(ownLabels(l)).toEqual([]);
    expect(outboundDestinations(l)).toEqual([]);
  });
});

describe("outflowConcentration() — volume_out_usd can be null, not just absent", () => {
  it("null volume_out_usd rows normalize to 0 in both the total and the sort, without throwing", () => {
    const rows: CounterpartyRow[] = [
      { counterparty_address: "0xaaa1000000000000000000000000000000aaa1", counterparty_address_label: null, interaction_count: 1, total_volume_usd: null, volume_in_usd: null, volume_out_usd: null },
      { counterparty_address: "0xbbb2000000000000000000000000000000bbb2", counterparty_address_label: null, interaction_count: 1, total_volume_usd: 40, volume_in_usd: 0, volume_out_usd: 40 },
      { counterparty_address: "0xccc3000000000000000000000000000000ccc3", counterparty_address_label: null, interaction_count: 1, total_volume_usd: null, volume_in_usd: null, volume_out_usd: null },
    ];
    const cpResponse: CounterpartiesResponse = { pagination: { is_last_page: true }, data: rows };
    const result = outflowConcentration(lookups({ counterparties: ok(cpResponse) }));
    expect(result).toEqual({ share: 1, to: "0xbbb2000000000000000000000000000000bbb2", totalOut: 40 });
  });
});

describe("activity() — a block_timestamp that already ends in 'Z' is used as-is", () => {
  it("does not get a second 'Z' appended before Date.parse", () => {
    const tx = txRow({ from: R, to: USER, ts: "2026-09-15T14:00:00Z" });
    const act = activity(lookups({ transactions: ok(txs([tx])) }), NOW);
    expect(act?.daysSinceNewest).toBe(1);
    expect(act?.daysSinceLastOut).toBe(1);
  });
});

describe("classify() — transactions rows with a null tokens_received are treated as no inbound transfers", () => {
  it("the poisoner scan skips a row whose tokens_received is null instead of throwing", () => {
    const tx: TxRow = {
      chain: "ethereum",
      method: "transfer(address,uint256)",
      tokens_sent: [{ token_symbol: "ETH", token_amount: 1, token_address: "0x0", chain: "ethereum", from_address: R, to_address: USER, from_address_label: null, to_address_label: null }],
      tokens_received: null,
      volume_usd: 1,
      block_timestamp: "2026-09-01T00:00:00",
      transaction_hash: "0x" + "d".repeat(64),
      source_type: "transfer",
    };
    const d = classify(lookups({ transactions: ok(txs([tx])) }), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "active" });
  });
});

describe("classify() — a wallet with no real outbound history still resolves 'active' when its own timestamp is unusable", () => {
  it("an empty block_timestamp on the only outbound row leaves daysSinceLastOut undefined; headline shows '?' and confidence stays low", () => {
    const tx = txRow({ hash: "0x" + "b".repeat(64), from: R, to: USER, ts: "" });
    const d = classify(lookups({ transactions: ok(txs([tx])) }), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "active", confidence: "low" });
    expect(d.headline).toMatch(/last sent \? days ago/);
  });
});

describe("rule 3 REGRESSION — a funder can carry the 🏦 marker with a generic wealth-tag label (no entity name)", () => {
  it("still credits an exchange funder; the evidence text falls back to 'The exchange'", () => {
    const l = binanceDeposit();
    const fundingHash = "0x" + "9".repeat(64);
    l.txLookups = l.txLookups.map((x) => (x.role === "funding" ? { ...x, result: ok(lookup(fundingHash, [transfer(GAS, R, "🏦 High Activity [0x943080]", "[0xe46077]", "ETH", 0.002)])) } : x));
    const d = classify(l, NOW);
    const ev = d.evidence.find((e) => e.code === "FUNDED_BY_EXCHANGE");
    expect(ev).toBeDefined();
    expect(ev?.meaning).toMatch(/^The exchange paid this address's first gas/);
  });
});

describe("rule 4 REGRESSION — a sweep destination can carry the 🏦 marker with a generic wealth-tag label (no entity name)", () => {
  it("still reads as a sweep-pattern deposit address; the entity falls back to 'an exchange'", () => {
    const sweep = txRow({ hash: "0x" + "4".repeat(64), from: R, to: HOT, amount: 50 });
    const l = lookups({
      transactions: ok(txs([sweep])),
      txLookups: [{ hash: sweep.transaction_hash, role: "outbound", result: ok(lookup(sweep.transaction_hash, [transfer(R, HOT, null, "🏦 High Activity [0x28c6c0]", "USDC", 50)])) }],
    });
    const d = classify(l, NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", sub: "sweep-pattern", entity: "an exchange", rule: 4 });
    expect(d.evidence[0]).toMatchObject({ code: "SWEEP_TO_EXCHANGE" });
  });
});
