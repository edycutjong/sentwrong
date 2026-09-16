/** The recorded addresses (specs/seed-data.md): one per edge the classifier must get right. Shared by seed.ts and bench.ts. */
import type { Chain } from "../packages/core/src/index.js";

export const FIXTURE_SET: Array<{ address: string; sender?: string; chain?: Chain; edge: string }> = [
  { address: "0xe460774c849089ee3edf0fb06da14c066caabbef", edge: "1 · hero: Binance deposit address, direct '🏦 Binance: Deposit' label, 15 sweeps to Binance 14" },
  { address: "0x321019b00b1e9c4987bcd995c5be7eb48f9367bb", edge: "2 · 20-month-old Binance deposit address, 27 sweeps, $64K through it" },
  { address: "0x5523aec7e0a5d5a02a80adbb5a8823732729c691", edge: "3 · Coinbase deposit address; hot wallet label carries the 🤖 🏦 prefix" },
  { address: "0x6465f379a78ad605a9a3f6d3d2abda2ce1bde0e2", edge: "4 · Coinbase deposit address created minutes before the spike: no own label yet → sweep-pattern rule" },
  { address: "0x42fbcba061088e71e4e785a5cd2d30cdc42d2023", edge: "5 · native-ETH Binance deposit address, 44 sweeps, gas funder is NOT the exchange" },
  { address: "0xfcfd07356a8e00957ea822eaf8aa43844fd3a69c", edge: "6 · createForwarder contract funded by Binance 14, forwards to BitGo MultiSig → forwarder state" },
  { address: "0x000000000000000000000000000000000000dEaD", edge: "7 · burn address: Nansen HTTP 422 'Burn address not allowed'" },
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", edge: "8 · USDC token contract: search/general short-circuit, 0 credits" },
  { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", edge: "9 · Uniswap V2 router: non-token contract via related-wallets 'Deployed by'; transactions times out (shown)" },
  { address: "0x4004000c2108e1ed5206b42a3baca0969cc6a02c", edge: "10 · fresh withdrawal recipient: 1 in / 0 out, first-funder EMPTY → dormant stranger" },
  { address: "0x3ff462b155011159f9afe68b0a3c509dc6f462b0", edge: "11 · a person's wallet that deposits into Binance and has been address-poisoned (look-alike counterparties) → active stranger + warning" },
  { address: "0x3ff462b155011159f9afe68b0a3c509dc6f462b0", sender: "0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5", edge: "12 · same wallet with its first funder as 'your address' → your-own-wallet" },
  { address: "0x50b37a3ec6c04609968810801531f5021929eac9", edge: "13 · an address-poisoning look-alike: only ever 'receives' homoglyph tokens (ÚЅDТ) → poisoner state" },
];
