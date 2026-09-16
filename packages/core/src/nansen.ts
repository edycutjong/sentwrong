/**
 * Typed wrappers for the Nansen endpoints Sent Wrong uses. Field names and request bodies follow
 * docs.nansen.ai openapi.json (2026-09-15). Nothing here decides anything — see classify.ts.
 */
import type { NansenClient, CallOptions } from "./client.js";

export type Chain = "ethereum" | "base" | "arbitrum" | "polygon" | "optimism" | "bnb" | "avalanche" | "linea";
export const CHAINS: Chain[] = ["ethereum", "base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "linea"];

export type DateRange = { from: string; to: string };

/** profiler/address/transactions → data[] */
export type TxTokenInfo = {
  token_symbol: string; token_amount: number; price_usd?: number | null; value_usd?: number | null;
  token_address: string; chain: string; from_address: string; to_address: string;
  from_address_label?: string | null; to_address_label?: string | null;
};
export type TxRow = {
  chain: string; method: string; tokens_sent?: TxTokenInfo[] | null; tokens_received?: TxTokenInfo[] | null;
  volume_usd?: number | null; block_timestamp: string; transaction_hash: string; source_type: string;
};
export type TxResponse = { pagination: { page: number; per_page: number; is_last_page: boolean }; data: TxRow[] };

/** profiler/address/counterparties → data[] */
export type CounterpartyRow = {
  counterparty_address: string; counterparty_address_label?: string[] | null; interaction_count: number;
  total_volume_usd?: number | null; volume_in_usd?: number | null; volume_out_usd?: number | null;
  tokens_info?: Array<{ token_address: string; token_symbol: string; token_name: string; num_transfer: string }> | null;
};
export type CounterpartiesResponse = { pagination: { is_last_page: boolean }; data: CounterpartyRow[] };

/** profiler/address/first-funder → data[] (empty when the wallet never received native gas — a normal 200) */
export type FirstFunderRow = {
  wallet_address: string; first_funder_address: string; first_funder_name?: string | null;
  transaction_hash: string; block_timestamp: string; chain: string;
};
export type FirstFunderResponse = { data: FirstFunderRow[] };

/** profiler/address/related-wallets → data[] */
export type RelatedWalletRow = {
  address: string; address_label?: string | null; relation: string; transaction_hash: string;
  block_timestamp: string; order: number; chain: string;
};
export type RelatedWalletsResponse = { data: RelatedWalletRow[] };

/** transaction-with-token-transfer-lookup → data[] — the only 1-credit place an ENTITY label ("🏦 Binance 14") appears */
export type TokenTransfer = {
  from_address: string; from_address_label?: string | null; to_address: string; to_address_label?: string | null;
  token_address: string; token_symbol: string; token_amount: number; dated_value_usd?: number | null; transfer_id?: string;
};
export type TxLookupRow = {
  chain: string; transaction_hash: string; from_address: string; from_address_label: string | null;
  to_address: string; to_address_label: string | null; native_value: number | null; dated_native_value_usd: number | null;
  receipt_status: number | null; block_timestamp: string; token_transfer_array: TokenTransfer[] | null;
};
export type TxLookupResponse = { data: TxLookupRow[] };

/** search/general → tokens[] / entities[] */
export type SearchResponse = {
  tokens: Array<{ name: string; symbol: string; chain: string; address: string; rank?: number | null; market_cap?: number | null }>;
  entities: Array<{ name: string; tags: string[]; rank?: number | null }>;
  total_results: number;
};

/** profiler/address/labels (100 credits) → data[] */
export type LabelRow = { label: string; category?: string | null; kind?: string[] };
export type LabelsResponse = { data: LabelRow[] };

/** Wide, fixed window: the recipient's whole history that the profiler indexes. Fixed dates keep cache keys stable. */
export const ALL_TIME: DateRange = { from: "2015-07-30", to: "2030-01-01" };
/** The last `days` days as whole dates (cache keys change once a day, and a fixture's stored `now` reproduces its window). */
export function recentWindow(now: number, days = 14): DateRange {
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(now - days * day), to: iso(now + day) };
}

export const nansen = {
  transactions: (c: NansenClient, address: string, chain: Chain, date: DateRange, perPage = 100, opts?: CallOptions) =>
    c.post<TxResponse>("profiler/address/transactions", { address, chain, date, hide_spam_token: true, pagination: { page: 1, per_page: perPage }, order_by: [{ field: "block_timestamp", direction: "DESC" }] },
      ["data[].method", "data[].tokens_sent[].to_address", "data[].tokens_received[].from_address", "data[].block_timestamp", "data[].transaction_hash"], opts),
  counterparties: (c: NansenClient, address: string, chain: Chain, date: DateRange, perPage = 20, opts?: CallOptions) =>
    c.post<CounterpartiesResponse>("profiler/address/counterparties", { address, chain, date, source_input: "Combined", group_by: "wallet", pagination: { page: 1, per_page: perPage }, order_by: [{ field: "interaction_count", direction: "DESC" }] },
      ["data[].counterparty_address", "data[].counterparty_address_label", "data[].interaction_count", "data[].volume_in_usd", "data[].volume_out_usd"], opts),
  firstFunder: (c: NansenClient, address: string, opts?: CallOptions) =>
    c.post<FirstFunderResponse>("profiler/address/first-funder", { address, chain: "all" },
      ["data[].first_funder_address", "data[].first_funder_name", "data[].transaction_hash"], opts),
  relatedWallets: (c: NansenClient, address: string, chain: Chain, opts?: CallOptions) =>
    c.post<RelatedWalletsResponse>("profiler/address/related-wallets", { address, chain, pagination: { page: 1, per_page: 50 } },
      ["data[].address", "data[].relation", "data[].address_label"], opts),
  txLookup: (c: NansenClient, transaction_hash: string, chain: Chain, opts?: CallOptions) =>
    c.post<TxLookupResponse>("transaction-with-token-transfer-lookup", { chain, transaction_hash },
      ["data[].to_address_label", "data[].token_transfer_array[].to_address_label", "data[].token_transfer_array[].from_address_label"], opts),
  search: (c: NansenClient, search_query: string, opts?: CallOptions) =>
    c.post<SearchResponse>("search/general", { search_query, result_type: "any", limit: 10 }, ["tokens[].address", "tokens[].chain", "entities[].name"], opts),
  /** 100 credits. Only ever called from an explicit --deep / "Deep check" action. */
  labels: (c: NansenClient, address: string, chain: Chain | "all", opts?: CallOptions) =>
    c.post<LabelsResponse>("profiler/address/labels", { address, chain, pagination: { page: 1, per_page: 100 } }, ["data[].label", "data[].category", "data[].kind"], opts),
};
