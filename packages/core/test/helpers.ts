/**
 * Fake Nansen responses modelled on the live spike (specs/spike.md, 2026-09-16). Builders return exactly the fields the
 * engine reads, in the shapes openapi.json documents. Tests compose them into a Lookups object for classify(), or into a
 * fakeClient route table for the full sentWrong() path.
 */
import { NansenClient, type ClientOptions } from "../src/client.js";
import type { Lookups, LookupResult } from "../src/lookups.js";
import type { TxResponse, CounterpartiesResponse, RelatedWalletsResponse, FirstFunderResponse, TxLookupResponse, SearchResponse, TxRow, TokenTransfer, LabelsResponse } from "../src/nansen.js";

export const R = "0xe460774c849089ee3edf0fb06da14c066caabbef"; // recipient (Binance deposit address in the spike)
export const HOT = "0x28c6c06298d514db089934071355e5743bf21d60"; // Binance 14
export const GAS = "0x9430801ebaf509ad49202aabc5f5bc6fd8a3daf8"; // Binance gas dripper
export const USER = "0x16c794fc2f2c6f4fd1c4b1b9e1e0a0e5f0c1d2e3"; // the person who deposits
export const SENDER = "0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5";
export const KEY = "nsn_test_key_0000000000000000000000";

export const ok = <T,>(data: T): LookupResult<T> => ({ ok: true, data });
export const fail = <T,>(error: string, status = 0): LookupResult<T> => ({ ok: false, error, status });
export const burn422 = <T,>(): LookupResult<T> => fail("{\"error\":\"Burn address not allowed\",\"message\":\"Burn address '0x…' is not allowed\"}", 422);

export function txRow(o: { hash?: string; ts?: string; from: string; to: string; symbol?: string; amount?: number; fromLabel?: string | null; toLabel?: string | null; method?: string }): TxRow {
  const t = { token_symbol: o.symbol ?? "USDT", token_amount: o.amount ?? 100, token_address: "0xdac17f958d2ee523a2206206994597c13d831ec7", chain: "ethereum", from_address: o.from, to_address: o.to, from_address_label: o.fromLabel ?? null, to_address_label: o.toLabel ?? null };
  return { chain: "ethereum", method: o.method ?? "transfer(address,uint256)", tokens_sent: [t], tokens_received: [t], volume_usd: o.amount ?? 100, block_timestamp: o.ts ?? "2026-09-16T13:53:11", transaction_hash: o.hash ?? `0x${o.from.slice(2, 10)}${o.to.slice(2, 10)}${(o.ts ?? "x").replace(/\D/g, "")}`.padEnd(66, "0"), source_type: "transfer" };
}
export const txs = (rows: TxRow[], last = true): TxResponse => ({ pagination: { page: 1, per_page: 100, is_last_page: last }, data: rows });
export const cps = (rows: Array<{ address: string; label?: string[] | null; n?: number; in?: number; out?: number }>): CounterpartiesResponse => ({
  pagination: { is_last_page: true },
  data: rows.map((r) => ({ counterparty_address: r.address, counterparty_address_label: r.label ?? null, interaction_count: r.n ?? 1, total_volume_usd: (r.in ?? 0) + (r.out ?? 0), volume_in_usd: r.in ?? 0, volume_out_usd: r.out ?? 0, tokens_info: [] })),
});
export const related = (rows: Array<{ address: string; relation: string; label?: string | null }>): RelatedWalletsResponse => ({ data: rows.map((r, i) => ({ address: r.address, address_label: r.label ?? null, relation: r.relation, transaction_hash: "0x" + "f".repeat(64), block_timestamp: "2026-09-01T14:00:23Z", order: i + 1, chain: "ethereum" })) });
export const funder = (address: string, name = "High Balance", chain = "ethereum", hash = "0x" + "a".repeat(64)): FirstFunderResponse => ({ data: [{ wallet_address: R, first_funder_address: address, first_funder_name: name, transaction_hash: hash, block_timestamp: "2026-09-01T14:00:23Z", chain }] });
export const noFunder = (): FirstFunderResponse => ({ data: [] });
export const transfer = (from: string, to: string, fromLabel: string | null, toLabel: string | null, symbol = "USDT", amount = 316.56): TokenTransfer => ({ from_address: from, from_address_label: fromLabel, to_address: to, to_address_label: toLabel, token_address: "0xdac1", token_symbol: symbol, token_amount: amount, dated_value_usd: amount });
export const lookup = (hash: string, transfers: TokenTransfer[], top: { toLabel?: string | null } = {}): TxLookupResponse => ({ data: [{ chain: "ethereum", transaction_hash: hash, from_address: transfers[0]?.from_address ?? R, from_address_label: "", to_address: "0xdac17f958d2ee523a2206206994597c13d831ec7", to_address_label: top.toLabel ?? "pssssssshao.eth", native_value: 0, dated_native_value_usd: 0, receipt_status: 1, block_timestamp: "2026-09-16T13:53:11Z", token_transfer_array: transfers }] });
export const search = (tokens: Array<{ address: string; symbol: string; name?: string; chain?: string }> = []): SearchResponse => ({ tokens: tokens.map((t) => ({ name: t.name ?? t.symbol, symbol: t.symbol, chain: t.chain ?? "ethereum", address: t.address, rank: 1 })), entities: [], total_results: tokens.length });
export const labels = (rows: Array<{ label: string; category?: string; kind?: string[] }>): LabelsResponse => ({ data: rows });

/** An empty-but-successful Lookups for `address`; override the pieces a test cares about. */
export function lookups(over: Partial<Lookups> = {}): Lookups {
  return { address: R, chain: "ethereum", search: ok(search()), transactions: ok(txs([])), counterparties: ok(cps([])), related: ok(related([])), firstFunder: ok(noFunder()), txLookups: [], skipped: [], ...over };
}

/** The hero: Binance deposit address as recorded live — 15 sweeps to Binance 14, gas from the Binance dripper. */
export function binanceDeposit(over: Partial<Lookups> = {}): Lookups {
  const sweep1 = txRow({ hash: "0x" + "1".repeat(64), from: R, to: HOT, ts: "2026-09-16T13:53:11", amount: 316.56 });
  const sweep2 = txRow({ hash: "0x" + "2".repeat(64), from: R, to: HOT, ts: "2026-09-10T08:00:00", amount: 103.05 });
  const dep = txRow({ hash: "0x" + "3".repeat(64), from: USER, to: R, ts: "2026-09-16T13:50:00", amount: 316.56 });
  return lookups({
    transactions: ok(txs([sweep1, dep, sweep2])),
    counterparties: ok(cps([{ address: USER, label: ["High Activity"], n: 20, in: 2763 }, { address: HOT, label: ["Token Billionaire"], n: 15, out: 2953 }, { address: GAS, label: ["High Balance"], n: 1, in: 5 }])),
    related: ok(related([{ address: GAS, relation: "First Funder", label: "High Balance" }])),
    firstFunder: ok(funder(GAS, "High Balance", "ethereum", "0x" + "9".repeat(64))),
    txLookups: [
      { hash: sweep1.transaction_hash, role: "outbound", result: ok(lookup(sweep1.transaction_hash, [transfer(R, HOT, "🏦 Binance: Deposit [0xe46077]", "🏦 Binance 14 [0x28c6c0]")])) },
      { hash: sweep2.transaction_hash, role: "outbound", result: ok(lookup(sweep2.transaction_hash, [transfer(R, HOT, "🏦 Binance: Deposit [0xe46077]", "🏦 Binance 14 [0x28c6c0]", "USDT", 103.05)])) },
      { hash: dep.transaction_hash, role: "inbound", result: ok(lookup(dep.transaction_hash, [transfer(USER, R, "High Activity [0x16c794]", "🏦 Binance: Deposit [0xe46077]")])) },
      { hash: "0x" + "9".repeat(64), role: "funding", result: ok(lookup("0x" + "9".repeat(64), [transfer(GAS, R, "🏦 Binance [0x943080]", "[0xe46077]", "ETH", 0.002)])) },
    ],
    ...over,
  });
}

/** A NansenClient whose network is a lookup table: (endpoint, body) → JSON | Response. Records calls like the real one. */
export function fakeClient(routes: (endpoint: string, body: Record<string, unknown>) => unknown, opts: ClientOptions = {}) {
  const fetchImpl: typeof fetch = async (url, init) => {
    const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const out = routes(endpoint, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new NansenClient(KEY, { fetchImpl, rps: 1000, ...opts });
}

/** Route table reproducing the hero over the wire (for gather()/sentWrong() tests). */
export function binanceRoutes(endpoint: string, body: Record<string, unknown>): unknown {
  const l = binanceDeposit();
  if (endpoint === "search/general") return search();
  if (endpoint === "profiler/address/transactions") return (l.transactions as { data: TxResponse }).data;
  if (endpoint === "profiler/address/counterparties") return (l.counterparties as { data: CounterpartiesResponse }).data;
  if (endpoint === "profiler/address/related-wallets") return (l.related as { data: RelatedWalletsResponse }).data;
  if (endpoint === "profiler/address/first-funder") return (l.firstFunder as { data: FirstFunderResponse }).data;
  if (endpoint === "transaction-with-token-transfer-lookup") {
    const hit = l.txLookups.find((x) => x.hash === body.transaction_hash);
    if (hit && hit.result.ok) return hit.result.data;
    return { data: [] };
  }
  if (endpoint === "profiler/address/labels") return labels([{ label: "Binance", category: "exchange", kind: ["entity"] }, { label: "Deposit", category: "others", kind: ["entity-tag"] }]);
  throw new Error("unexpected " + endpoint);
}
