/**
 * Coverage gap-filler for src/text.ts: branches classify()'s own rule set never produces (an evidence-free
 * exchange match, a decision with no entity name, a transfer that IS known on routes the existing suite only
 * ever calls with an unknown one). actionFor() takes a plain Decision, so these are built by hand rather than
 * routed through classify() — that keeps this file decoupled from classify's rules, which some other agent owns.
 */
import { describe, it, expect } from "vitest";
import { actionFor, type Transfer } from "../src/text.js";
import type { Decision } from "../src/classify.js";

const ctx = { address: "0xrecipient0000000000000000000000000000", chain: "ethereum" };
const xfer: Transfer = { hash: "0xdeadbeef", date: "2026-09-16T13:50:00", amount: 42, symbol: "USDT", from: "0xsender000000000000000000000000000000", to: "0xrecipient0000000000000000000000000000" };

/** A minimal, valid Decision — every test overrides just the fields its branch cares about. */
function decision(over: Partial<Decision>): Decision {
  return { route: "retry", sub: "unknown", confidence: "low", headline: "", evidence: [], rule: 0, warnings: [], ...over };
}

describe("actionFor — entity/evidence/transfer fallbacks the existing classify()-driven tests never trigger", () => {
  it("exchange-wallet ticket falls back to 'the exchange' for both the name and the Nansen label when entity and evidence are both missing, and fills in a known transaction hash", () => {
    const d = decision({ route: "exchange-deposit", sub: "exchange-wallet", entity: undefined, evidence: [] });
    const a = actionFor(d, { ...ctx, sender: xfer.from, transfer: xfer });
    expect(a.title).toBe("Support ticket for the exchange");
    expect(a.text).toContain('Nansen labels it "the exchange"');
    expect(a.text).toContain("(transaction 0xdeadbeef)");
  });

  it("deposit-address ticket (any sub other than exchange-wallet) falls back to 'the exchange' the same way when entity and evidence are both missing", () => {
    const d = decision({ route: "exchange-deposit", sub: "sweep-pattern", entity: undefined, evidence: [] });
    const a = actionFor(d, ctx);
    expect(a.title).toBe("Support ticket for the exchange");
    expect(a.text).toContain('Nansen labels it "the exchange"');
  });

  it("poisoner note fills in the real transaction hash when the transfer is known", () => {
    const d = decision({ route: "active-stranger", sub: "poisoner" });
    const a = actionFor(d, { ...ctx, transfer: xfer });
    expect(a.text).toContain("(tx 0xdeadbeef)");
  });

  it("active-stranger memo fills in the real transaction hash when the transfer is known", () => {
    const d = decision({ route: "active-stranger", sub: "active" });
    const a = actionFor(d, { ...ctx, transfer: xfer });
    expect(a.text).toContain("(tx 0xdeadbeef)");
  });

  it("forwarder note falls back to 'a custodian' / 'the custodian' when entity is unknown, and fills in the real transaction hash", () => {
    const d = decision({ route: "contract-or-burn", sub: "forwarder", entity: undefined });
    const a = actionFor(d, { ...ctx, transfer: xfer });
    expect(a.text).toContain("moved straight into a custodian's custody wallet");
    expect(a.text).toContain("no public support desk for the custodian itself");
    expect(a.text).toContain("(tx 0xdeadbeef)");
  });

  it("token-contract note falls back to an unnamed 'token contract' when entity is unknown, and fills in the real transaction hash", () => {
    const d = decision({ route: "contract-or-burn", sub: "token-contract", entity: undefined });
    const a = actionFor(d, { ...ctx, transfer: xfer });
    expect(a.text).toContain("is the token contract. Token contracts have no owner-controlled withdrawal");
    expect(a.text).toContain("(tx 0xdeadbeef)");
  });
});
