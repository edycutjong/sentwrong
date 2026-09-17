/**
 * Gather every Nansen response a verdict needs. All I/O lives here; classify.ts is pure.
 * Every lookup ends as ok/failed — a failure is data the verdict shows, never an exception.
 */
import type { NansenClient } from "./client.js";
import { NansenError } from "./client.js";
import { nansen, ALL_TIME, recentWindow, type Chain, type SearchResponse, type TxResponse, type CounterpartiesResponse, type RelatedWalletsResponse, type FirstFunderResponse, type TxLookupResponse, type LabelsResponse, type TxRow } from "./nansen.js";

export type LookupResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
export type TxLookup = { hash: string; role: "outbound" | "inbound" | "from-sender" | "funding"; result: LookupResult<TxLookupResponse> };

export type Lookups = {
  address: string;
  sender?: string;
  chain: Chain;
  search: LookupResult<SearchResponse>;
  transactions: LookupResult<TxResponse>;
  /** "14d" when the recent page was full (busy address — the all-time window is skipped), "all" otherwise */
  transactionsWindow: "14d" | "all";
  counterparties: LookupResult<CounterpartiesResponse>;
  related: LookupResult<RelatedWalletsResponse>;
  firstFunder: LookupResult<FirstFunderResponse>;
  txLookups: TxLookup[];
  senderRelated?: LookupResult<RelatedWalletsResponse>;
  /** only with --deep (100 credits) */
  deep?: LookupResult<LabelsResponse>;
  /** lookups skipped because an earlier one already decided the route (saves credits; listed in provenance notes) */
  skipped: string[];
};

export type GatherOptions = { sender?: string; chain?: Chain; deep?: boolean; now?: number };

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function settle<T>(p: Promise<T>): Promise<LookupResult<T>> {
  try { return { ok: true, data: await p }; }
  catch (e) {
    if (e instanceof NansenError) return { ok: false, error: e.bodyText.slice(0, 200), status: e.status };
    const err = e as Error;
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? e).slice(0, 200), status: 0 };
  }
}

export function isBurnRejection(r: LookupResult<unknown>): boolean {
  return !r.ok && r.status === 422 && /burn address/i.test(r.error);
}

const lc = (s: string) => s.toLowerCase();

/** Rows where the address sent tokens / received tokens (a contract call can be both). */
export function splitDirection(rows: TxRow[], address: string) {
  const a = lc(address);
  const outbound = rows.filter((r) => (r.tokens_sent ?? []).some((t) => lc(t.from_address) === a));
  const inbound = rows.filter((r) => (r.tokens_received ?? []).some((t) => lc(t.to_address) === a));
  return { outbound, inbound };
}

export async function gather(client: NansenClient, address: string, opts: GatherOptions = {}): Promise<Lookups> {
  if (!EVM_ADDRESS.test(address)) throw new Error(`not an EVM address: ${address}`);
  if (opts.sender && !EVM_ADDRESS.test(opts.sender)) throw new Error(`--from is not an EVM address: ${opts.sender}`);
  const chain = opts.chain ?? "ethereum";
  const a = lc(address);
  const sender = opts.sender ? lc(opts.sender) : undefined;
  const skipped: string[] = [];

  // 0 credits, fast: a token contract at this address ends the search before the expensive profiler calls start.
  const search = await settle(nansen.search(client, a));
  // the hit must be on the chain being asked about: search/general is chain-agnostic, and a token deployed at this address
  // on base says nothing about what the same address is on ethereum (independent review 2026-09-17, open item #10)
  const tokenHit = search.ok && search.data.tokens.some((t) => lc(t.address) === a && lc(t.chain) === chain);

  const now = opts.now ?? Date.now();
  let transactionsWindow: Lookups["transactionsWindow"] = "14d";
  const skip = <T,>(): LookupResult<T> => ({ ok: false, error: "skipped: token contract", status: 0 });
  let transactions: LookupResult<TxResponse> = skip(), counterparties: LookupResult<CounterpartiesResponse> = skip();
  let related: LookupResult<RelatedWalletsResponse> = skip(), firstFunder: LookupResult<FirstFunderResponse> = skip();
  let senderRelated: LookupResult<RelatedWalletsResponse> | undefined;
  if (tokenHit) skipped.push("profiler/address/transactions", "profiler/address/counterparties", "profiler/address/related-wallets", "profiler/address/first-funder");
  else {
    // stage 1: transactions over the last 14 days plus the three cheap identity lookups. 14 days answers in ≤ 6 s even on
    // the USDT contract and Binance 14 (measured 2026-09-16; the all-time window makes Nansen 500 after 30 s on the Uniswap
    // router). 10 s cap, one retry. A timeout is shown, never hidden.
    [transactions, related, firstFunder] = await Promise.all([
      settle(nansen.transactions(client, a, chain, recentWindow(now), 100, { timeoutMs: 10_000, retries: 1 })),
      settle(nansen.relatedWallets(client, a, chain)),
      settle(nansen.firstFunder(client, a)),
    ]);
    // stage 2: a quiet address (14-day page not full) gets its whole history — deposit addresses sweep rarely, and "no history
    // at all" must mean all-time, not "nothing in 14 days". Busy addresses (100 rows in 14 days) stay on the 14-day window,
    // for counterparties too: the all-time aggregate is what times out on hot wallets and routers, and it costs 5 credits.
    const busy = transactions.ok && !transactions.data.pagination.is_last_page;
    transactionsWindow = busy ? "14d" : "all";
    const window = busy ? recentWindow(now) : ALL_TIME;
    const [all, cp, sr] = await Promise.all([
      busy || !transactions.ok ? Promise.resolve(undefined) : settle(nansen.transactions(client, a, chain, ALL_TIME, 100, { timeoutMs: 10_000, retries: 0 })),
      settle(nansen.counterparties(client, a, chain, window, 20, { timeoutMs: 10_000, retries: 1 })),
      sender ? settle(nansen.relatedWallets(client, sender, chain)) : Promise.resolve(undefined),
    ]);
    counterparties = cp; senderRelated = sr;
    if (all) { if (all.ok) transactions = all; else skipped.push(`profiler/address/transactions all-time (${all.error}) — using the 14-day page`); }
  }
  // Which transaction hashes to look up: the newest 2 outbound (the sweeps), the newest inbound, the sender's transfer
  // if we can see it, and the funding transaction. These carry the entity labels the profiler rows do not.
  const txLookups: TxLookup[] = [];
  const burn = isBurnRejection(transactions) || isBurnRejection(counterparties);
  if (!tokenHit && !burn) {
    const wanted: Array<{ hash: string; role: TxLookup["role"] }> = [];
    if (transactions.ok) {
      const { outbound, inbound } = splitDirection(transactions.data.data, a);
      for (const r of outbound.slice(0, 2)) wanted.push({ hash: r.transaction_hash, role: "outbound" });
      // `?? []` here is unreachable: splitDirection's own `inbound` filter (line 54) already requires a non-null,
      // non-empty tokens_received on every row it returns, so this row can never have a null tokens_received.
      const fromSender = sender ? inbound.find((r) => (r.tokens_received /* v8 ignore next */ ?? []).some((t) => lc(t.from_address) === sender)) : undefined;
      if (fromSender) wanted.push({ hash: fromSender.transaction_hash, role: "from-sender" });
      else if (inbound[0]) wanted.push({ hash: inbound[0].transaction_hash, role: "inbound" });
    }
    if (firstFunder.ok && firstFunder.data.data[0] && lc(firstFunder.data.data[0].chain) === chain) wanted.push({ hash: firstFunder.data.data[0].transaction_hash, role: "funding" });
    const seen = new Set<string>();
    const unique = wanted.filter((w) => (seen.has(w.hash) ? false : (seen.add(w.hash), true)));
    const results = await Promise.all(unique.map((w) => settle(nansen.txLookup(client, w.hash, chain))));
    unique.forEach((w, i) => txLookups.push({ hash: w.hash, role: w.role, result: results[i] }));
  } else if (!tokenHit) skipped.push("transaction-with-token-transfer-lookup (burn address)");

  const deep = opts.deep ? await settle(nansen.labels(client, a, chain)) : undefined;
  return { address: a, sender, chain, search, transactions, transactionsWindow, counterparties, related, firstFunder, txLookups, senderRelated, deep, skipped };
}
