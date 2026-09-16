/**
 * Record the fixture set: run each address LIVE once, write every raw Nansen response the verdict touched plus the
 * verdict itself to fixtures/<address>.json. Responses are stored byte-for-byte and never edited. `npm run verify`
 * replays them offline and must reproduce every decision hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed          # all (~150 credits)
 *   npm run seed -- 0xe460 0x0000                                                # a subset by prefix
 */
import { CachedNansenClient, MemoryCache, sentWrong, writeFixture, type Fixture, type Chain } from "../packages/core/src/index.js";

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

const wanted = process.argv.slice(2).map((q) => q.toLowerCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.some((w) => f.address.toLowerCase().startsWith(w))) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0, totalCalls = 0;

for (const f of set) {
  // A fresh in-memory store per fixture: every response is fetched live and lands in the file; nothing is shared or reused.
  const store = new MemoryCache();
  const client = new CachedNansenClient(apiKey, { store });
  const now = Date.now();
  const verdict = await sentWrong(client, f.address, { sender: f.sender, chain: f.chain, now });
  const live = verdict.provenance.filter((c) => !c.cached && c.ok);
  const failed = verdict.provenance.filter((c) => !c.ok);
  const fixture: Fixture = {
    edge: f.edge, address: verdict.address, options: { sender: f.sender, chain: f.chain }, now, recordedAt: new Date(now).toISOString(),
    live: { calls: live.length, credits: verdict.credits, ms: verdict.ms }, responses: store.entries(), verdict,
  };
  const path = writeFixture(fixture);
  totalCredits += verdict.credits; totalCalls += live.length;
  console.log(`${verdict.address.slice(0, 10)}…${f.sender ? " --from" : ""} → ${path}  ${verdict.decision.route}/${verdict.decision.sub} (${verdict.decision.confidence}) · ${verdict.credits} cr / ${live.length} calls / ${(verdict.ms / 1000).toFixed(1)}s · ${verdict.hash.slice(0, 12)}${failed.length ? `  ⚠ ${failed.length} failed: ${failed.map((c) => `${c.endpoint} (${c.error?.slice(0, 40)})`).join(", ")}` : ""}`);
}
console.log(`\n${set.length} fixtures · ${totalCredits} credits · ${totalCalls} live calls`);
