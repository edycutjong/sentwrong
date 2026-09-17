/**
 * Coverage top-up for verdict.ts: the branches and fall-through paths the main suite (gather.test.ts,
 * boundary.test.ts, fixtures.test.ts) doesn't happen to exercise. Reuses fixtures/builders from ./helpers.ts —
 * no new fixtures, no network.
 */
import { describe, it, expect } from "vitest";
import { sentWrong, rowsFor, findTransfer } from "../src/verdict.js";
import type { CounterpartiesResponse, TxLookupResponse } from "../src/nansen.js";
import { fakeClient, binanceRoutes, binanceDeposit, lookups, cps, txs, related, noFunder, search, labels, ok, R, HOT } from "./helpers.js";

describe("findTransfer()", () => {
  it("falls through to undefined when the given sender never sent the recipient anything, even though other inbound transfers exist", () => {
    // binanceDeposit()'s only inbound transfer is USER -> R. HOT is a real, present counterparty (the sweep target),
    // but it never appears as the `from` of an inbound transfer to R — so the loop must exhaust without matching.
    const l = binanceDeposit({ sender: HOT });
    expect(findTransfer(l)).toBeUndefined();
  });
});

describe("rowsFor() / labelIndex() edge cases", () => {
  it("a null token_transfer_array on a tx lookup contributes no entity labels, not a crash", () => {
    const l = lookups({
      counterparties: ok(cps([{ address: HOT, label: ["Some Label"], n: 1, in: 5 }])),
      txLookups: [
        {
          hash: "0x" + "a".repeat(64),
          role: "outbound",
          result: ok<TxLookupResponse>({
            data: [
              {
                chain: "ethereum", transaction_hash: "0x" + "a".repeat(64), from_address: R, from_address_label: null,
                to_address: HOT, to_address_label: null, native_value: 0, dated_native_value_usd: 0, receipt_status: 1,
                block_timestamp: "2026-09-16T00:00:00Z", token_transfer_array: null,
              },
            ],
          }),
        },
      ],
    });
    const rows = rowsFor(l);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityLabel).toBeUndefined(); // no entity label was ever indexed for HOT
  });

  it("volume_in_usd/volume_out_usd missing entirely (not just 0) still sum to 0, not NaN", () => {
    const l = lookups({
      counterparties: ok<CounterpartiesResponse>({
        pagination: { is_last_page: true },
        data: [{ counterparty_address: HOT, counterparty_address_label: ["Label"], interaction_count: 2 }],
      }),
    });
    const rows = rowsFor(l);
    expect(rows[0]).toMatchObject({ address: HOT, interactions: 2, inUsd: 0, outUsd: 0 });
  });

  it("a label seen on a LATER occurrence of the same address backfills the earlier '—' placeholder", () => {
    const l = lookups({
      counterparties: ok<CounterpartiesResponse>({
        pagination: { is_last_page: true },
        data: [
          { counterparty_address: HOT, counterparty_address_label: null, interaction_count: 1, volume_in_usd: 1 },
          { counterparty_address: HOT, counterparty_address_label: ["Nice Label"], interaction_count: 1, volume_in_usd: 2 },
        ],
      }),
    });
    const rows = rowsFor(l);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Nice Label"); // first row alone would have left it at "—"
  });
});

describe("sentWrong() --deep edge cases", () => {
  it("an address with no entity ties (active-stranger) treats zero entity-kind labels as agreement", async () => {
    const c = fakeClient((e) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions") return txs([]);
      if (e === "profiler/address/counterparties") return cps([]);
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      if (e === "profiler/address/labels") return labels([{ label: "Some Tag", category: "other" }]); // no `kind` at all
      throw new Error("unexpected " + e);
    });
    const v = await sentWrong(c, R, { deep: true });
    expect(v.decision.route).toBe("active-stranger");
    expect(v.decision.entity).toBeUndefined(); // decision.entity is falsy: the outer ternary's other arm
    expect(v.deep).toMatchObject({ agrees: true, labels: ["Some Tag"] });
  });

  it("--deep disagreement falls back to 'no entity label' in the note when the profiler returns no entity-kind label at all", async () => {
    const c = fakeClient((e, b) => (e === "profiler/address/labels" ? labels([{ label: "Random Tag", category: "other" }]) : binanceRoutes(e, b)));
    const v = await sentWrong(c, R, { deep: true });
    expect(v.deep?.agrees).toBe(false);
    expect(v.deep?.note).toMatch(/disagrees: no entity label/);
    expect(v.decision.warnings.at(-1)).toBe(v.deep?.note);
  });

  it("--deep surfaces a failed labels call as a 0-credit, agreeing deep block — never a disagreement warning", async () => {
    const c = fakeClient((e, b) => (e === "profiler/address/labels" ? new Response("labels down", { status: 500 }) : binanceRoutes(e, b)));
    const v = await sentWrong(c, R, { deep: true });
    expect(v.deep).toMatchObject({ labels: [], credits: 0, agrees: true });
    expect(v.deep?.note).toMatch(/^deep check failed:/);
    expect(v.decision.warnings.some((w) => w.includes("disagrees"))).toBe(false);
  });

  it("agreement defaults to true for a route that is neither entity-bearing nor active-stranger (a burn address)", async () => {
    const c = fakeClient((e) => {
      if (e === "search/general") return search();
      if (e === "profiler/address/transactions" || e === "profiler/address/counterparties") return new Response('{"error":"Burn address not allowed","message":"Burn address \'0x…\' is not allowed"}', { status: 422 });
      if (e === "profiler/address/related-wallets") return related([]);
      if (e === "profiler/address/first-funder") return noFunder();
      if (e === "profiler/address/labels") return labels([{ label: "Random Tag", category: "other", kind: ["entity"] }]);
      throw new Error("unexpected " + e);
    });
    const v = await sentWrong(c, "0x000000000000000000000000000000000000dead", { deep: true });
    expect(v.decision.route).toBe("contract-or-burn");
    expect(v.decision.entity).toBeUndefined();
    expect(v.deep?.agrees).toBe(true); // decision.entity is falsy and the route isn't active-stranger: the ternary's final `true`
  });
});
