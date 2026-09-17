import { describe, it, expect } from "vitest";
import { parseLabel } from "../src/labels.js";

// Branch coverage for labels.ts:42 — `if (entity && (GENERIC.test(entity) || ENS.test(entity))) entity = undefined;`
// The existing packages/core/test/labels.test.ts exercises entity-truthy-and-neither-generic-nor-ENS ("Binance 14")
// and entity-falsy (full-text generics like "Token Billionaire"), but never a case where the *entity substring itself*
// (as opposed to the whole label text) matches GENERIC or ENS after being carved out — this file fills those two arms.
describe("parseLabel — entity re-checked against GENERIC/ENS after being carved out (labels.ts:42)", () => {
  it("a bare wealth/activity tag with a trailing counter ('Whale 5') is not treated as an entity", () => {
    // text = "Whale 5" doesn't match GENERIC as a whole (trailing digit), so it isn't `generic`; the digit-suffix
    // stripping in the `else if (!generic)` branch then carves entity = "Whale", which DOES match GENERIC on its
    // own — exercising the `entity && GENERIC.test(entity)` true arm.
    const p = parseLabel("Whale 5");
    expect(p).toMatchObject({ text: "Whale 5", entity: undefined, generic: false });
  });

  it("an ENS name used as the entity half of an '<entity>: <role>' label is not treated as an entity", () => {
    // colon path carves entity = "vitalik.eth" before any generic/ENS check on the full text runs; GENERIC.test
    // on that entity is false, so this exercises the `ENS.test(entity)` true arm specifically.
    const p = parseLabel("vitalik.eth: Deposit");
    expect(p).toMatchObject({ text: "vitalik.eth: Deposit", entity: undefined, role: "Deposit" });
  });
});
