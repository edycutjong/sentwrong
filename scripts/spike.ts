/**
 * Day-one spike (specs/spike.md): can cheap Nansen profiler data tell an exchange DEPOSIT address from a contract,
 * a burn address and an ordinary wallet? Runs the raw lookups on a fixed set of addresses and prints what each field
 * actually says. No decisions are made here — the branch rules in classify.ts were written FROM this output.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run spike
 */
import { cachedClientFromEnv, nansen, ALL_TIME, type Chain, type TxRow } from "../packages/core/src/index.js";

type Probe = { address: string; kind: "exchange-deposit" | "contract-or-burn" | "eoa"; note: string };
/** Deposit addresses were harvested live on 2026-09-16 from one USDT sweep block into Binance 14 and one into Coinbase 10:
 *  unlabelled senders whose tokens landed in the hot wallet. Contracts/burns are canonical Ethereum addresses. EOAs are
 *  recent Binance-withdrawal recipients (ordinary users) plus vitalik.eth. */
export const PROBES: Probe[] = [
  { address: "0xe460774c849089ee3edf0fb06da14c066caabbef", kind: "exchange-deposit", note: "Binance 14 sweep 13:53:11, 316 USDT" },
  { address: "0x5fb480c4838dd4510ee5dda9255a555aa1a4d780", kind: "exchange-deposit", note: "Binance 14 sweep, 90.9 USDT" },
  { address: "0x321019b00b1e9c4987bcd995c5be7eb48f9367bb", kind: "exchange-deposit", note: "Binance 14 sweep, 6000 USDT" },
  { address: "0xf2c83e2706aba5976606d977a3e6def3af3a891c", kind: "exchange-deposit", note: "Binance 14 sweep, 1000 USDT" },
  { address: "0x50b3c2dd0dc03670817000d56fed3479a081eac9", kind: "exchange-deposit", note: "Binance 14 sweep, 975 USDT" },
  { address: "0x42fbcba061088e71e4e785a5cd2d30cdc42d2023", kind: "exchange-deposit", note: "Binance 14 sweep, 0.29 ETH" },
  { address: "0x5523aec7e0a5d5a02a80adbb5a8823732729c691", kind: "exchange-deposit", note: "Coinbase 10 sweep 13:54:11, 160 USDC" },
  { address: "0x4fdf56eb266fe3dd9366eb37650c6f6e3f954f60", kind: "exchange-deposit", note: "Coinbase 10 sweep, 1500 USDC" },
  { address: "0xbe5906566f82c6e5921d68492e92f3594ac6b7c3", kind: "exchange-deposit", note: "Coinbase 10 sweep, 636 USDC" },
  { address: "0x6465f379a78ad605a9a3f6d3d2abda2ce1bde0e2", kind: "exchange-deposit", note: "Coinbase 10 sweep, 319 USDC" },
  { address: "0x000000000000000000000000000000000000dEaD", kind: "contract-or-burn", note: "burn address" },
  { address: "0x0000000000000000000000000000000000000000", kind: "contract-or-burn", note: "zero address" },
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", kind: "contract-or-burn", note: "USDC token contract" },
  { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", kind: "contract-or-burn", note: "Uniswap V2 router" },
  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", kind: "contract-or-burn", note: "USDT token contract" },
  { address: "0x4004000c2108e1ed5206b42a3baca0969cc6a02c", kind: "eoa", note: "Binance withdrawal recipient (user)" },
  { address: "0x62777f8a37b782c7cc22a64c608a9332c0b8c5c2", kind: "eoa", note: "Binance withdrawal recipient, 250K USDT" },
  { address: "0xd8dA6BF26964aF9D7eEd9e03E4415D37aA96045", kind: "eoa", note: "vitalik.eth" },
];

const chain: Chain = "ethereum";
const client = cachedClientFromEnv({ ttlMs: 24 * 3600 * 1000 });
const lc = (s: string) => s.toLowerCase();
const only = process.argv.slice(2);

for (const p of PROBES) {
  if (only.length && !only.some((o) => lc(p.address).startsWith(lc(o)))) continue;
  const a = lc(p.address);
  console.log(`\n=== ${p.kind.toUpperCase()}  ${p.address}  (${p.note})`);
  const before = client.creditsSpent;
  const [tx, cp, ff, search] = await Promise.allSettled([
    nansen.transactions(client, a, chain, ALL_TIME, 100),
    nansen.counterparties(client, a, chain, ALL_TIME, 10),
    nansen.firstFunder(client, a),
    nansen.search(client, a),
  ]);
  // transactions: direction, counterparties, cadence
  if (tx.status === "fulfilled") {
    const rows = tx.value.data;
    const outs = rows.filter((r) => (r.tokens_sent ?? []).some((t) => lc(t.from_address) === a));
    const ins = rows.filter((r) => (r.tokens_received ?? []).some((t) => lc(t.to_address) === a));
    const outTo = new Map<string, number>();
    for (const r of outs) for (const t of r.tokens_sent ?? []) if (lc(t.from_address) === a) outTo.set(t.to_address, (outTo.get(t.to_address) ?? 0) + 1);
    const methods = [...new Set(rows.map((r) => r.method))].slice(0, 6);
    console.log(`transactions: ${rows.length} rows (last_page=${tx.value.pagination.is_last_page}) · ${ins.length} in / ${outs.length} out · methods: ${methods.join(", ")}`);
    console.log(`  outbound destinations: ${[...outTo.entries()].map(([k, v]) => `${k.slice(0, 10)}…×${v}`).join(", ") || "none"}`);
    const first = rows.at(-1)?.block_timestamp, last = rows[0]?.block_timestamp;
    console.log(`  span: ${first ?? "-"} → ${last ?? "-"}`);
    // entity labels via tx lookup on the newest 2 outbound hashes and the newest inbound hash
    const hashes = [...outs.slice(0, 2), ...ins.slice(0, 1)].map((r: TxRow) => r.transaction_hash);
    for (const h of hashes) {
      try {
        const look = await nansen.txLookup(client, h, chain);
        const row = look.data[0];
        const parts = (row?.token_transfer_array ?? []).map((t) => `${(t.from_address_label || "").trim() || t.from_address.slice(0, 8)} → ${(t.to_address_label || "").trim() || t.to_address.slice(0, 8)} (${t.token_symbol} ${t.token_amount})`);
        console.log(`  lookup ${h.slice(0, 12)}: to_address_label=${JSON.stringify(row?.to_address_label)} from=${JSON.stringify(row?.from_address_label)} · transfers: ${parts.join(" | ") || "none"}`);
      } catch (e) { console.log(`  lookup ${h.slice(0, 12)} FAILED: ${(e as Error).message.slice(0, 100)}`); }
    }
  } else console.log(`transactions FAILED: ${(tx.reason as Error).message.slice(0, 160)}`);
  if (cp.status === "fulfilled") {
    console.log(`counterparties: ${cp.value.data.length} rows`);
    for (const r of cp.value.data.slice(0, 5)) console.log(`  ${r.counterparty_address.slice(0, 12)}… ${JSON.stringify(r.counterparty_address_label)} n=${r.interaction_count} in=$${Math.round(r.volume_in_usd ?? 0)} out=$${Math.round(r.volume_out_usd ?? 0)}`);
  } else console.log(`counterparties FAILED: ${(cp.reason as Error).message.slice(0, 160)}`);
  if (ff.status === "fulfilled") {
    const r = ff.value.data[0];
    console.log(r ? `first-funder: ${r.first_funder_address} name=${JSON.stringify(r.first_funder_name)} at ${r.block_timestamp} (${r.chain})` : "first-funder: EMPTY (no native gas ever received)");
    if (r) {
      try {
        const look = await nansen.txLookup(client, r.transaction_hash, chain);
        const t = look.data[0]?.token_transfer_array?.[0];
        console.log(`  funding tx lookup: from_address_label=${JSON.stringify(look.data[0]?.from_address_label)} transfer0=${JSON.stringify(t?.from_address_label)}`);
      } catch (e) { console.log(`  funding tx lookup FAILED: ${(e as Error).message.slice(0, 100)}`); }
    }
  } else console.log(`first-funder FAILED: ${(ff.reason as Error).message.slice(0, 160)}`);
  if (search.status === "fulfilled") console.log(`search/general: tokens=${search.value.tokens.map((t) => `${t.symbol}@${t.chain}`).join(",") || "-"} entities=${search.value.entities.map((e) => e.name).join(",") || "-"}`);
  else console.log(`search FAILED: ${(search.reason as Error).message.slice(0, 160)}`);
  console.log(`  credits this probe: ${client.creditsSpent - before}`);
}
const live = client.calls.filter((c) => !c.cached);
console.log(`\ntotal: ${client.creditsSpent} credits · ${live.length} live calls · ${client.calls.filter((c) => !c.ok).length} failed`);
