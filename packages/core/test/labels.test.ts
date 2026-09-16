import { describe, it, expect } from "vitest";
import { parseLabel, stripLabel, isDepositLabel, isContractLabel, isSpoofSymbol, lookAlike } from "../src/labels.js";

describe("parseLabel — the shapes seen live on 2026-09-16", () => {
  it.each([
    ["🏦 Binance: Deposit [0xe46077]", { text: "Binance: Deposit", entity: "Binance", role: "Deposit", exchange: true, generic: false }],
    ["🏦 Binance 14 [0x28c6c0]", { text: "Binance 14", entity: "Binance", role: undefined, exchange: true }],
    ["🤖 🏦 Coinbase [0xa9d1e0]", { text: "Coinbase", entity: "Coinbase", exchange: true }],
    ["🏦 Kraken: Hot Wallet [0xf30ba1]", { entity: "Kraken", role: "Hot Wallet", exchange: true }],
    ["🤖 Tether: USDT Token [0xdac17f]", { entity: "Tether", role: "USDT Token", exchange: false }],
    ["🤖 🏦 Uniswap: V2 Router 2 [0x7a250d]", { entity: "Uniswap", role: "V2 Router 2" }],
    ["Token Billionaire", { entity: undefined, generic: true, exchange: false }],
    ["High Activity [0x16c794]", { text: "High Activity", entity: undefined, generic: true }],
    ["sofaking.eth*", { entity: undefined, generic: true }],
    ["​​🤖 Utility Contract [0x54243d]", { text: "Utility Contract", entity: "Utility Contract" }],
    ["Roobet: Deposit [0x14c579]", { entity: "Roobet", role: "Deposit", exchange: false }],
  ])("%s", (raw, want) => {
    expect(parseLabel(raw)).toMatchObject(want);
  });
  it("empty / null / stub-only labels parse to undefined", () => {
    expect(parseLabel(null)).toBeUndefined();
    expect(parseLabel("")).toBeUndefined();
    expect(parseLabel("[0xfcfd07]")).toBeUndefined();
  });
  it("stripLabel removes emoji, zero-width characters and the address stub", () => {
    expect(stripLabel("🏦 Binance: Deposit [0xe46077]")).toBe("Binance: Deposit");
    expect(stripLabel("﻿🤖 X️  Y")).toBe("X Y");
  });
});

describe("classifiers on labels", () => {
  it("isDepositLabel: only '<entity>: Deposit'", () => {
    expect(isDepositLabel(parseLabel("🏦 Binance: Deposit [0x1]"))).toBe(true);
    expect(isDepositLabel(parseLabel("Roobet: Deposit"))).toBe(true);
    expect(isDepositLabel(parseLabel("🏦 Binance 14"))).toBe(false);
    expect(isDepositLabel(parseLabel("🏦 Kraken: Hot Wallet"))).toBe(false);
    expect(isDepositLabel(undefined)).toBe(false);
  });
  it("isContractLabel: contract words, never wealth tags", () => {
    expect(isContractLabel(parseLabel("🤖 Tether: USDT Token"))).toBe(true);
    expect(isContractLabel(parseLabel("🤖 Utility Contract"))).toBe(true);
    expect(isContractLabel(parseLabel("🤖 🏦 Uniswap: V2 Router 2"))).toBe(true);
    expect(isContractLabel(parseLabel("Token Billionaire"))).toBe(false);
    expect(isContractLabel(parseLabel("🏦 Binance: Deposit"))).toBe(false);
    expect(isContractLabel(parseLabel("Proxy"))).toBe(false); // generic on its own
  });
  it("isSpoofSymbol: homoglyphs and digit swaps of real tickers", () => {
    expect(isSpoofSymbol("ÚЅDТ")).toBe(true);
    expect(isSpoofSymbol("U5DТ")).toBe(true);
    expect(isSpoofSymbol("U5DT")).toBe(true);
    expect(isSpoofSymbol("USDC")).toBe(false);
    expect(isSpoofSymbol("USDT")).toBe(false);
    expect(isSpoofSymbol("PEPE")).toBe(false);
    expect(isSpoofSymbol("1INCH")).toBe(false); // a real ticker with a digit
    expect(isSpoofSymbol(null)).toBe(false);
  });
  it("lookAlike: same first 4 and last 4 hex, different address", () => {
    expect(lookAlike("0x50b3c2dd0dc03670817000d56fed3479a081eac9", "0x50b37a3ec6c04609968810801531f5021929eac9")).toBe(true);
    expect(lookAlike("0x50b3c2dd0dc03670817000d56fed3479a081eac9", "0x50B3C2DD0DC03670817000D56FED3479A081EAC9")).toBe(false);
    expect(lookAlike("0x50b3c2dd0dc03670817000d56fed3479a081eac9", "0x16c794fc2f2c6f4fd1c4b1b9e1e0a0e5f0c1d2e3")).toBe(false);
  });
});
