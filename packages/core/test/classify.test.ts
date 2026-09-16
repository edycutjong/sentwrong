import { describe, it, expect } from "vitest";
import { classify } from "../src/classify.js";
import { decisionHash } from "../src/verdict.js";
import { actionFor } from "../src/text.js";
import { lookups, binanceDeposit, ok, fail, burn422, txs, txRow, cps, related, funder, noFunder, lookup, transfer, search, R, HOT, GAS, USER, SENDER } from "./helpers.js";

const NOW = Date.parse("2026-09-16T14:00:00Z");
const codes = (l: ReturnType<typeof lookups>) => classify(l, NOW).evidence.map((e) => e.code);

describe("rule 1 — burn address (Nansen HTTP 422)", () => {
  it("transactions 422 'Burn address' → contract-or-burn/burn, high, BURN_422", () => {
    const d = classify(lookups({ transactions: burn422(), counterparties: burn422() }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "burn", confidence: "high", rule: 1 });
    expect(d.evidence[0].code).toBe("BURN_422");
    expect(d.evidence[0].field).toContain("HTTP 422");
  });
  it("burn wins even when counterparties succeeded with rows (only transactions refused)", () => {
    const d = classify(lookups({ transactions: burn422(), counterparties: ok(cps([{ address: HOT, n: 5 }])) }), NOW);
    expect(d.route).toBe("contract-or-burn");
    expect(d.warnings).toEqual([]); // a 422 burn is a signal, not a failure
  });
  it("a 422 for another reason is NOT a burn — it is a warning and falls through", () => {
    const d = classify(lookups({ transactions: fail("Invalid address format", 422) }), NOW);
    expect(d.route).not.toBe("contract-or-burn");
    expect(d.warnings[0]).toMatch(/transactions failed: Invalid address format \(HTTP 422\)/);
  });
});

describe("rule 2 — token contract (search/general)", () => {
  it("a token at the address → contract-or-burn/token-contract, entity = symbol", () => {
    const d = classify(lookups({ search: ok(search([{ address: R, symbol: "USDC", name: "USD Coin" }])) }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "token-contract", confidence: "high", entity: "USDC", rule: 2 });
    expect(d.evidence[0]).toMatchObject({ code: "TOKEN_CONTRACT", field: "search/general → tokens[].address" });
  });
  it("a token at a DIFFERENT address does not match (case-insensitive compare on ours)", () => {
    const d = classify(lookups({ search: ok(search([{ address: HOT, symbol: "USDC" }])) }), NOW);
    expect(d.route).not.toBe("contract-or-burn");
    const up = classify(lookups({ search: ok(search([{ address: R.toUpperCase().replace("0X", "0x"), symbol: "USDC" }])) }), NOW);
    expect(up.sub).toBe("token-contract");
  });
});

describe("rule 3 — '<Exchange>: Deposit' label on the address itself", () => {
  it("the hero: Binance deposit → exchange-deposit/direct-label, high, all four evidence terms", () => {
    const d = classify(binanceDeposit(), NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", sub: "direct-label", confidence: "high", entity: "Binance", rule: 3 });
    expect(d.evidence.map((e) => e.code)).toEqual(["OWN_DEPOSIT_LABEL", "SWEEP_TO_EXCHANGE", "OUTFLOW_CONCENTRATED", "FUNDED_BY_EXCHANGE"]);
    expect(d.evidence[0].value).toBe("🏦 Binance: Deposit [0xe46077]");
    expect(d.headline).toMatch(/Binance deposit address/);
  });
  it("the label can arrive on the inbound side (to_address_label) too", () => {
    const l = binanceDeposit();
    l.txLookups = [l.txLookups[2]]; // only the inbound lookup, where R is the to_address
    const d = classify(l, NOW);
    expect(d.sub).toBe("direct-label");
    expect(d.entity).toBe("Binance");
  });
  it("Coinbase's '🤖 🏦 Coinbase' hot wallet (no colon, two emoji) still parses as the Coinbase entity", () => {
    const l = binanceDeposit();
    l.txLookups = [{ hash: "0x1", role: "outbound", result: ok(lookup("0x1", [transfer(R, HOT, "🏦 Coinbase: Deposit [0x5523ae]", "🤖 🏦 Coinbase [0xa9d1e0]", "USDC", 160)])) }];
    const d = classify(l, NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", entity: "Coinbase" });
    expect(d.evidence[1]).toMatchObject({ code: "SWEEP_TO_EXCHANGE", value: "🤖 🏦 Coinbase [0xa9d1e0]" });
  });
  it("without the counterparties concentration and funder the verdict is still high (the label alone decides)", () => {
    const d = classify(binanceDeposit({ counterparties: fail("timeout"), firstFunder: ok(noFunder()) }), NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", confidence: "high" });
    expect(d.evidence.map((e) => e.code)).toEqual(["OWN_DEPOSIT_LABEL", "SWEEP_TO_EXCHANGE"]);
    expect(d.warnings).toEqual(["counterparties failed: timeout"]);
  });
});

describe("rule 3b — the exchange's own wallet", () => {
  it("'🏦 Binance 14' as the address's own label → exchange-deposit/exchange-wallet, high, with the exchange named", () => {
    const out = txRow({ hash: "0x" + "c".repeat(64), from: HOT, to: USER, amount: 5.38 });
    const d = classify(lookups({ address: HOT, transactions: ok(txs([out], false)), txLookups: [{ hash: out.transaction_hash, role: "outbound", result: ok(lookup(out.transaction_hash, [transfer(HOT, USER, "🏦 Binance 14 [0x28c6c0]", "[0x400400]")])) }] }), NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", sub: "exchange-wallet", confidence: "high", entity: "Binance" });
    expect(d.evidence.map((e) => e.code)).toEqual(["OWN_EXCHANGE_LABEL", "ACTIVITY"]);
    expect(d.headline).toMatch(/Binance's own wallet/);
  });
  it("REGRESSION: '🤖 🏦 Uniswap: V2 Router 2' carries the 🏦 marker but is a contract → rule 5, entity Uniswap", () => {
    const out = txRow({ hash: "0x" + "c".repeat(64), from: R, to: USER });
    const d = classify(lookups({ transactions: ok(txs([out], false)), related: ok(related([{ address: "0x9c33", relation: "Deployed by" }])), txLookups: [{ hash: out.transaction_hash, role: "outbound", result: ok(lookup(out.transaction_hash, [transfer(R, USER, "🤖 🏦 Uniswap: V2 Router 2 [0x7a250d]", null)])) }] }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "contract", entity: "Uniswap", rule: 5 });
  });
  it("REGRESSION: a wallet whose only outbound goes to a 🏦-marked DEX router is a person swapping, not a deposit address", () => {
    const swap = txRow({ hash: "0x" + "e".repeat(64), from: R, to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d" });
    const d = classify(lookups({ transactions: ok(txs([swap])), txLookups: [{ hash: swap.transaction_hash, role: "outbound", result: ok(lookup(swap.transaction_hash, [transfer(R, "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", null, "🤖 🏦 Uniswap: V2 Router 2 [0x7a250d]")])) }] }), NOW);
    expect(d.route).toBe("active-stranger");
  });
  it("a '<X>: Deposit' label still wins over the exchange-wallet rule", () => {
    expect(classify(binanceDeposit(), NOW).sub).toBe("direct-label");
  });
});

describe("rule 4 — sweep pattern for a not-yet-labelled deposit address", () => {
  const fresh = (toLabel: string, over: Partial<ReturnType<typeof lookups>> = {}) => {
    const sweep = txRow({ hash: "0x" + "4".repeat(64), from: R, to: HOT, amount: 319 });
    return lookups({
      transactions: ok(txs([sweep, txRow({ from: USER, to: R, amount: 319 })])),
      counterparties: ok(cps([{ address: HOT, label: ["High Activity"], n: 2, out: 319 }, { address: USER, n: 1, in: 319 }])),
      txLookups: [{ hash: sweep.transaction_hash, role: "outbound", result: ok(lookup(sweep.transaction_hash, [transfer(R, HOT, "[0x6465f3]", toLabel, "USDC", 319)])) }],
      ...over,
    });
  };
  it("all outbound to '🤖 🏦 Coinbase' + 100 % outflow concentration → exchange-deposit/sweep-pattern, high", () => {
    const d = classify(fresh("🤖 🏦 Coinbase [0xa9d1e0]"), NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", sub: "sweep-pattern", confidence: "high", entity: "Coinbase", rule: 4 });
    expect(d.evidence.map((e) => e.code)).toEqual(["SWEEP_TO_EXCHANGE", "OUTFLOW_CONCENTRATED"]);
    expect(d.warnings).toContain("only one sweep seen so far — the address is new; the pattern is consistent but thin");
  });
  it("without concentration or funder corroboration the confidence is medium", () => {
    const d = classify(fresh("🏦 Kraken: Hot Wallet [0xf30ba1]", { counterparties: fail("timeout") }), NOW);
    expect(d).toMatchObject({ route: "exchange-deposit", confidence: "medium", entity: "Kraken" });
  });
  it("funder labelled with the same exchange raises it to high", () => {
    const d = classify(fresh("🏦 Kraken: Hot Wallet [0xf30ba1]", { counterparties: fail("timeout"), firstFunder: ok(funder(GAS, "x", "ethereum", "0x" + "9".repeat(64))), txLookups: [
      { hash: "0x" + "4".repeat(64), role: "outbound", result: ok(lookup("0x4", [transfer(R, HOT, "[0x6465f3]", "🏦 Kraken: Hot Wallet [0xf30ba1]")])) },
      { hash: "0x" + "9".repeat(64), role: "funding", result: ok(lookup("0x9", [transfer(GAS, R, "🏦 Kraken [0x9430]", "[0x6465f3]", "ETH", 0.001)])) },
    ] }), NOW);
    expect(d.confidence).toBe("high");
    expect(d.evidence.map((e) => e.code)).toContain("FUNDED_BY_EXCHANGE");
  });
  it("REGRESSION: a user wallet sending to its own '<X>: Deposit' address is NOT a deposit address", () => {
    const d = classify(fresh("🏦 Binance: Deposit [0x50b3c2]"), NOW);
    expect(d.route).toBe("active-stranger");
    expect(d.evidence.map((e) => e.code)).toContain("DEPOSITS_INTO_EXCHANGE");
  });
  it("one exchange destination among unlabelled ones is not a sweep", () => {
    const s1 = txRow({ hash: "0x" + "5".repeat(64), from: R, to: HOT }), s2 = txRow({ hash: "0x" + "6".repeat(64), from: R, to: USER });
    const d = classify(lookups({ transactions: ok(txs([s1, s2])), txLookups: [
      { hash: s1.transaction_hash, role: "outbound", result: ok(lookup(s1.transaction_hash, [transfer(R, HOT, null, "🏦 Binance 14 [0x28c6c0]")])) },
      { hash: s2.transaction_hash, role: "outbound", result: ok(lookup(s2.transaction_hash, [transfer(R, USER, null, null)])) },
    ] }), NOW);
    expect(d.route).toBe("active-stranger");
  });
});

describe("rule 5 — contracts", () => {
  it("related-wallets 'Deployed by' → contract-or-burn/contract, high, DEPLOYED_BY", () => {
    const d = classify(lookups({ related: ok(related([{ address: "0x9c33eacc2f50e39940d3afaf2c7b8246b681a374", relation: "Deployed by" }])) }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "contract", confidence: "high", rule: 5 });
    expect(d.evidence[0].code).toBe("DEPLOYED_BY");
  });
  it("a contract label alone ('🤖 Tether: USDT Token') → contract, medium, with the entity", () => {
    const d = classify(lookups({ txLookups: [{ hash: "0x1", role: "inbound", result: ok(lookup("0x1", [transfer(USER, R, null, "🤖 Tether: USDT Token [0xdac17f]")])) }] }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "contract", confidence: "medium", entity: "Tether" });
    expect(d.evidence[0].code).toBe("CONTRACT_LABEL");
  });
  it("'Token Billionaire' is a wealth tag, not a contract label", () => {
    const d = classify(lookups({ txLookups: [{ hash: "0x1", role: "inbound", result: ok(lookup("0x1", [transfer(USER, R, null, "Token Billionaire [0xe46077]")])) }] }), NOW);
    expect(d.route).not.toBe("contract-or-burn");
  });
  it("a deployed contract that forwards everything to a named custodian → forwarder (ask the issuer)", () => {
    const fwd = txRow({ hash: "0x" + "7".repeat(64), from: R, to: "0x094a430a5e2f633e841180bae30d9eb82001765b", symbol: "ETH", amount: 0.24 });
    const d = classify(lookups({
      transactions: ok(txs([fwd])),
      related: ok(related([{ address: HOT, relation: "First Funder" }, { address: "0x9f5c", relation: "Deployed by" }, { address: "0xffa3", relation: "Created by" }])),
      txLookups: [{ hash: fwd.transaction_hash, role: "outbound", result: ok(lookup(fwd.transaction_hash, [transfer(R, "0x094a430a5e2f633e841180bae30d9eb82001765b", "[0xfcfd07]", "🤖 BitGo MultiSig [0x094a43]", "ETH", 0.24)])) }],
    }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "forwarder", confidence: "medium", entity: "BitGo MultiSig" });
    expect(d.evidence.map((e) => e.code)).toEqual(["DEPLOYED_BY", "FORWARDS_TO_CUSTODIAN"]);
  });
  it("REGRESSION (QA 2026-09-16): a DEX router whose outflow lands in labelled pools is a contract, NOT a forwarder", () => {
    const swap = txRow({ hash: "0x" + "6".repeat(64), from: R, to: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", symbol: "WETH", amount: 1.2 });
    const d = classify(lookups({
      transactions: ok(txs([swap])),
      related: ok(related([{ address: "0x6c9f", relation: "Deployed by", label: "High Activity" }])),
      txLookups: [{ hash: swap.transaction_hash, role: "outbound", result: ok(lookup(swap.transaction_hash, [transfer(R, "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", "🤖 🏦 Uniswap: V3 Router 2 [0xe59242]", "🤖 🏦 Uniswap: V3 USDC-WETH (0.05%) Liquidity Pool  [0x88e6a0]", "WETH", 1.2)])) }],
    }), NOW);
    expect(d).toMatchObject({ route: "contract-or-burn", sub: "contract", rule: 5 });
    expect(d.evidence.map((e) => e.code)).not.toContain("FORWARDS_TO_CUSTODIAN");
    expect(d.headline).not.toMatch(/custody/);
  });
  it("exchange evidence outranks the contract flag (exchange-owned forwarder contracts)", () => {
    const l = binanceDeposit({ related: ok(related([{ address: "0x9f5c", relation: "Deployed by" }])) });
    expect(classify(l, NOW).route).toBe("exchange-deposit");
  });
});

describe("rule 6 — your own wallet", () => {
  const base = (over: Partial<ReturnType<typeof lookups>> = {}) => lookups({ sender: SENDER, transactions: ok(txs([txRow({ from: SENDER, to: R, symbol: "ETH", amount: 0.05 })])), counterparties: ok(cps([{ address: SENDER, n: 1, in: 100 }])), ...over });
  it("recipient's first funder is the sender → your-own-wallet/funded, FUNDED_BY_SENDER", () => {
    const d = classify(base({ firstFunder: ok(funder(SENDER, "")) }), NOW);
    expect(d).toMatchObject({ route: "your-own-wallet", sub: "funded", confidence: "high", rule: 6 });
    expect(d.evidence[0].code).toBe("FUNDED_BY_SENDER");
  });
  it("recipient appears in the sender's related-wallets → your-own-wallet/related", () => {
    const d = classify(base({ senderRelated: ok(related([{ address: R, relation: "Deployed by" }])) }), NOW);
    expect(d).toMatchObject({ route: "your-own-wallet", sub: "related" });
    expect(d.evidence[0]).toMatchObject({ code: "RELATED_TO_SENDER", value: `Deployed by — ${R.slice(0, 6)}…${R.slice(-4)}` });
  });
  it("sender appears in the recipient's related-wallets → your-own-wallet/related", () => {
    const d = classify(base({ related: ok(related([{ address: SENDER, relation: "First Funder" }])) }), NOW);
    expect(d).toMatchObject({ route: "your-own-wallet", sub: "related" });
  });
  it("no sender → the same data is an active stranger", () => {
    const d = classify(base({ sender: undefined, firstFunder: ok(funder(SENDER, "")) }), NOW);
    expect(d.route).toBe("active-stranger");
  });
  it("REGRESSION: 'your address' labelled as an exchange wallet skips the own-wallet check with a warning", () => {
    const tx = txRow({ hash: "0x" + "8".repeat(64), from: HOT, to: R, amount: 249999 });
    const d = classify(lookups({ sender: HOT, transactions: ok(txs([tx])), firstFunder: ok(funder(HOT, "High Activity")), txLookups: [{ hash: tx.transaction_hash, role: "from-sender", result: ok(lookup(tx.transaction_hash, [transfer(HOT, R, "🏦 Binance 18 [0x9696f5]", "[0x62777f]")])) }] }), NOW);
    expect(d.route).toBe("active-stranger");
    expect(d.warnings[0]).toMatch(/labelled as an exchange wallet/);
  });
});

describe("rules 7–9 — strangers, honestly", () => {
  it("no transactions at all → active-stranger/fresh, low, NO_HISTORY", () => {
    const d = classify(lookups(), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "fresh", confidence: "low", rule: 7 });
    expect(d.evidence[0].code).toBe("NO_HISTORY");
  });
  it("inbound only, never sent → dormant, low; an exchange withdrawal in is evidence of a person", () => {
    const tx = txRow({ hash: "0x" + "8".repeat(64), from: HOT, to: R, amount: 5.38 });
    const d = classify(lookups({ transactions: ok(txs([tx])), counterparties: ok(cps([{ address: HOT, label: ["Token Billionaire"], n: 1, in: 5 }])), txLookups: [{ hash: tx.transaction_hash, role: "inbound", result: ok(lookup(tx.transaction_hash, [transfer(HOT, R, "🏦 Binance 14 [0x28c6c0]", "[0x400400]")])) }] }), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "dormant", confidence: "low", rule: 8 });
    expect(d.evidence.map((e) => e.code)).toEqual(["ACTIVITY", "FUNDED_BY_EXCHANGE", "COUNTERPARTIES"]);
  });
  it("sent within 90 days → active, medium; older → active, low", () => {
    const mk = (ts: string) => lookups({ transactions: ok(txs([txRow({ from: R, to: USER, ts })])) });
    expect(classify(mk("2026-09-01T00:00:00"), NOW)).toMatchObject({ sub: "active", confidence: "medium", rule: 9 });
    expect(classify(mk("2025-01-01T00:00:00"), NOW)).toMatchObject({ sub: "active", confidence: "low" });
    expect(classify(mk("2026-09-01T00:00:00"), NOW).headline).toMatch(/last sent 15 days ago/);
  });
  it("an address that only 'receives' homoglyph tokens and never sends → poisoner, high", () => {
    const rows = [txRow({ from: USER, to: R, symbol: "ÚЅDТ", amount: 47.05 }), txRow({ from: USER, to: R, symbol: "ÚЅDТ", amount: 47.05, ts: "2026-05-30T12:34:00" }), txRow({ from: SENDER, to: R, symbol: "U5DТ", amount: 29, ts: "2026-03-19T23:19:00" })];
    const d = classify(lookups({ transactions: ok(txs(rows)) }), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "poisoner", confidence: "high" });
    expect(d.evidence[0]).toMatchObject({ code: "SPOOF_TOKEN_TRANSFERS", field: "profiler/address/transactions → tokens_received[].token_symbol" });
    expect(d.evidence[0].value).toMatch(/3 of 3 inbound transfers/);
  });
  it("a single odd symbol does not make a poisoner; real USDT inbound never does", () => {
    expect(classify(lookups({ transactions: ok(txs([txRow({ from: USER, to: R, symbol: "ÚЅDТ" })])) }), NOW).sub).toBe("dormant");
    expect(classify(lookups({ transactions: ok(txs([txRow({ from: USER, to: R }), txRow({ from: USER, to: R })])) }), NOW).sub).toBe("dormant");
  });
  it("look-alike counterparties (same first/last hex) raise a poisoning warning on the wallet", () => {
    const d = classify(lookups({ transactions: ok(txs([txRow({ from: R, to: USER })])), counterparties: ok(cps([{ address: "0x50b3c2dd0dc03670817000d56fed3479a081eac9" }, { address: "0x50b37a3ec6c04609968810801531f5021929eac9" }, { address: "0x50b3bd85c1c00e7f8200855d595a40283e6deac9" }, { address: USER }])) }), NOW);
    expect(d.warnings.some((w) => /3 of its counterparties are look-alikes/.test(w))).toBe(true);
  });
  it("its own deposits into an exchange are shown as evidence of a person with an account", () => {
    const s = txRow({ hash: "0x" + "5".repeat(64), from: R, to: HOT });
    const d = classify(lookups({ transactions: ok(txs([s])), txLookups: [{ hash: s.transaction_hash, role: "outbound", result: ok(lookup(s.transaction_hash, [transfer(R, HOT, null, "🏦 Binance: Deposit [0x50b3c2]")])) }] }), NOW);
    expect(d.evidence.find((e) => e.code === "DEPOSITS_INTO_EXCHANGE")?.meaning).toMatch(/deposits into Binance/);
  });
});

describe("retry — never a verdict from nothing", () => {
  it("transactions + counterparties + related all failed → retry with LOOKUPS_FAILED", () => {
    const d = classify(lookups({ transactions: fail("timeout"), counterparties: fail("HTTP 503", 503), related: fail("fetch failed") }), NOW);
    expect(d).toMatchObject({ route: "retry", rule: 0 });
    expect(d.evidence[0].code).toBe("LOOKUPS_FAILED");
    expect(d.warnings).toHaveLength(3);
  });
  it("REGRESSION (QA 2026-09-16): transactions failed but the others answered → retry, never 'nothing on record'", () => {
    const d = classify(lookups({ transactions: fail("timeout"), counterparties: ok(cps([{ address: USER, n: 3, in: 100 }])), related: ok(related([])) }), NOW);
    expect(d).toMatchObject({ route: "retry", sub: "failed", rule: 0 });
    expect(d.evidence[0].code).toBe("TRANSACTIONS_FAILED");
    expect(d.headline).not.toMatch(/nothing on record/i);
    expect(d.warnings).toEqual(["transactions failed: timeout"]);
  });
  it("0 rows from a successful transactions call is still 'fresh' — and says Nansen may simply not index it", () => {
    const d = classify(lookups({ counterparties: ok(cps([])) }), NOW);
    expect(d).toMatchObject({ route: "active-stranger", sub: "fresh", rule: 7 });
    expect(d.headline).toMatch(/does not index/);
  });
  it("one surviving core lookup is enough to decide (with the failures listed)", () => {
    const d = classify(lookups({ transactions: fail("timeout"), counterparties: fail("timeout"), related: ok(related([{ address: "0x9c", relation: "Deployed by" }])) }), NOW);
    expect(d.route).toBe("contract-or-burn");
    expect(d.warnings).toEqual(["transactions failed: timeout", "counterparties failed: timeout"]);
  });
});

describe("decision hash", () => {
  it("is stable across runs and ignores nothing that matters", () => {
    const a = classify(binanceDeposit(), NOW), b = classify(binanceDeposit(), NOW);
    const ctx = { address: R, chain: "ethereum" };
    expect(decisionHash(a, actionFor(a, ctx))).toBe(decisionHash(b, actionFor(b, ctx)));
    expect(decisionHash(a, actionFor(a, ctx))).toHaveLength(64);
  });
  it("changes when the route, the entity or an evidence value changes", () => {
    const a = classify(binanceDeposit(), NOW);
    const l = binanceDeposit(); l.txLookups[0].result = ok(lookup("0x1", [transfer(R, HOT, "🏦 Kraken: Deposit [0xe46077]", "🏦 Kraken: Hot Wallet")]));
    const b = classify(l, NOW);
    const ctx = { address: R, chain: "ethereum" };
    expect(decisionHash(a, actionFor(a, ctx))).not.toBe(decisionHash(b, actionFor(b, ctx)));
  });
  it("does not depend on timing, warnings, or the USD total of the outflow (priced at current rates, drifts by the minute)", () => {
    const a = classify(binanceDeposit(), NOW);
    const b = classify(binanceDeposit({ counterparties: ok(cps([{ address: HOT, out: 2954 }])) }), NOW); // $2,954 instead of $2,953: same share
    b.warnings.push("a transient note");
    const ctx = { address: R, chain: "ethereum" };
    expect(decisionHash(a, actionFor(a, ctx))).toBe(decisionHash(b, actionFor(b, ctx)));
  });
});
