import { describe, it, expect } from "vitest";
import { classify } from "../src/classify.js";
import { actionFor } from "../src/text.js";
import { binanceDeposit, lookups, burn422, ok, search, related, txs, txRow, funder, R, SENDER, USER } from "./helpers.js";

const NOW = Date.parse("2026-09-16T14:00:00Z");
const ctx = { address: R, chain: "ethereum" };

describe("one copy button per route", () => {
  it("exchange-deposit → a support ticket naming the exchange, with the Nansen evidence and bracketed blanks only for what we cannot know", () => {
    const a = actionFor(classify(binanceDeposit(), NOW), ctx);
    expect(a.kind).toBe("ticket");
    expect(a.text).toMatch(/^Subject: Funds sent to a Binance deposit address by mistake/);
    expect(a.text).toContain("Hello Binance support");
    expect(a.text).toContain("🏦 Binance: Deposit [0xe46077]");
    expect(a.text).toContain("[your address]");
    expect(a.text).toContain("[transaction hash]");
    expect(a.text).not.toMatch(/undefined|null|NaN/);
  });
  it("the ticket is filled in when the sender and the transfer are known", () => {
    const a = actionFor(classify(binanceDeposit({ sender: SENDER }), NOW), { ...ctx, sender: SENDER, transfer: { hash: "0xabc", date: "2026-09-16T13:50:00", amount: 316.56, symbol: "USDT", from: SENDER, to: R } });
    expect(a.text).toContain("On 2026-09-16 I sent 316.56 USDT from my wallet " + SENDER);
    expect(a.text).toContain("(transaction 0xabc)");
    expect(a.text).not.toContain("[your address]");
  });
  it("your-own-wallet → a checklist, no ticket, the scam warning", () => {
    const a = actionFor(classify(lookups({ sender: SENDER, transactions: ok(txs([txRow({ from: R, to: USER }), txRow({ from: SENDER, to: R })])), firstFunder: ok(funder(SENDER)) }), NOW), { ...ctx, sender: SENDER });
    expect(a.kind).toBe("checklist");
    expect(a.text).toMatch(/Switch that wallet to ethereum/);
    expect(a.text).toMatch(/Anyone offering "recovery" for a fee is a scam/);
  });
  it("active-stranger → an on-chain memo with a 10 % thank-you offer and honest odds per state", () => {
    const active = actionFor(classify(lookups({ transactions: ok(txs([txRow({ from: R, to: USER })])) }), NOW), ctx);
    expect(active.kind).toBe("memo");
    expect(active.text).toContain("10% back as a thank-you");
    expect(active.text).toMatch(/Honest odds: The owner moves funds/);
    const dormant = actionFor(classify(lookups({ transactions: ok(txs([txRow({ from: USER, to: R })])) }), NOW), ctx);
    expect(dormant.text).toMatch(/Honest odds: The owner has never sent anything/);
    const fresh = actionFor(classify(lookups(), NOW), ctx);
    expect(fresh.text).toMatch(/no history at all yet/);
  });
  it("poisoner → report-it note, never a memo (there is nobody honest to write to)", () => {
    const rows = [txRow({ from: USER, to: R, symbol: "ÚЅDТ" }), txRow({ from: USER, to: R, symbol: "ÚЅDТ", ts: "2026-05-30T12:34:00" })];
    const a = actionFor(classify(lookups({ transactions: ok(txs(rows)) }), NOW), ctx);
    expect(a.kind).toBe("note");
    expect(a.title).toMatch(/Scam address/);
    expect(a.text).toMatch(/chainabuse\.com/);
    expect(a.text).not.toContain("thank-you");
  });
  it("burn / token contract / contract → a note for the records with the scam warning; forwarder → ask the issuer", () => {
    const burn = actionFor(classify(lookups({ transactions: burn422(), counterparties: burn422() }), NOW), ctx);
    expect(burn.text).toMatch(/is a burn address\. Nothing sent to a burn address can be moved by anyone/);
    const token = actionFor(classify(lookups({ search: ok(search([{ address: R, symbol: "USDC" }])) }), NOW), ctx);
    expect(token.text).toMatch(/is the USDC token contract\. Token contracts have no owner-controlled withdrawal/);
    const contract = actionFor(classify(lookups({ related: ok(related([{ address: "0x9c", relation: "Deployed by" }])) }), NOW), ctx);
    expect(contract.text).toMatch(/is a smart contract\. Unless the contract's owner has a documented recovery function/);
    for (const a of [burn, token, contract]) { expect(a.kind).toBe("note"); expect(a.text).toMatch(/offering to recover it for a fee is a scam/); }
  });
  it("retry → a note that says nothing was decided", () => {
    const a = actionFor(classify(lookups({ transactions: { ok: false, error: "timeout", status: 0 }, counterparties: { ok: false, error: "timeout", status: 0 }, related: { ok: false, error: "timeout", status: 0 } }), NOW), ctx);
    expect(a.title).toBe("No verdict");
    expect(a.text).toMatch(/Nothing was decided/);
  });
});
