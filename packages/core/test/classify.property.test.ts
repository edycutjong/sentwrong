/**
 * Property-based verification of classify() — the one function that must never be wrong.
 *
 * Instead of examples, fast-check generates whole `Lookups` objects (every Nansen response the engine reads, in the shapes
 * openapi.json documents, with real label strings, 422 refusals, timeouts, spoof tokens, deployer relations, senders)
 * and checks the invariants the product promises (spec F3/F4/F8) on every one of them. NUM_RUNS × the number of
 * properties is the case count the README publishes; `npm run check:submission` compares the two.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classify, type Route } from "../src/classify.js";
import { decisionHash } from "../src/verdict.js";
import { actionFor } from "../src/text.js";
import { isBurnRejection, type Lookups, type LookupResult, type TxLookup } from "../src/lookups.js";
import type { CounterpartiesResponse, SearchResponse, TxResponse, RelatedWalletsResponse, FirstFunderResponse, TxLookupResponse, TokenTransfer } from "../src/nansen.js";
import { ok, fail, burn422, txs, txRow, cps, related, funder, noFunder, lookup, transfer, search, R, HOT, GAS, USER, SENDER } from "./helpers.js";

export const NUM_RUNS = 10_000;
/** 10,000 runs take ~2 s on a laptop and 5–8 s on a CI runner under coverage — well past vitest's 5 s default */
const TIMEOUT_MS = 120_000;
const NOW = Date.parse("2026-09-16T14:00:00Z");

const ROUTES: Route[] = ["exchange-deposit", "your-own-wallet", "active-stranger", "contract-or-burn", "retry"];
/** every sub-state a route may carry (docs/SCORING.md) */
const SUBS: Record<Route, string[]> = {
  "exchange-deposit": ["direct-label", "exchange-wallet", "sweep-pattern"],
  "your-own-wallet": ["related", "funded"],
  "active-stranger": ["fresh", "dormant", "active", "poisoner"],
  "contract-or-burn": ["burn", "token-contract", "contract", "forwarder"],
  retry: ["failed"],
};

// ── generators ──────────────────────────────────────────────────────────────────────────────────────────────────────
const hex = (n: number) => fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: n, maxLength: n });
const POOL = [R, HOT, GAS, USER, SENDER, "0x" + "a".repeat(40), "0x" + "b".repeat(40), "0xE592427A0AEce92De3Edee1F18E0157C05861564"];
const address = fc.oneof({ arbitrary: fc.constantFrom(...POOL), weight: 4 }, { arbitrary: hex(40).map((h) => "0x" + h), weight: 1 });
/** label strings exactly as Nansen returns them, plus the empties */
const label = fc.constantFrom<string | null>(
  null,
  "",
  "🏦 Binance: Deposit [0xe46077]",
  "🏦 Binance 14 [0x28c6c0]",
  "🏦 Binance [0x943080]",
  "🏦 Coinbase: Deposit [0x5523ae]",
  "🤖 🏦 Coinbase [0xa9d1e0]",
  "🏦 Kraken: Hot Wallet",
  "🤖 🏦 Uniswap: V2 Router 2 [0x7a250d]",
  "🤖 Uniswap: V3 USDC-WETH Liquidity Pool",
  "🤖 Tether: USDT Token",
  "🤖 BitGo MultiSig [0x4004]",
  "High Activity [0x16c794]",
  "Token Billionaire",
  "High Balance",
  "pssssssshao.eth",
  "[0xe46077]",
);
const symbol = fc.constantFrom("USDT", "USDC", "ETH", "WETH", "ÚЅDТ", "USD7", "UЅDC", "DAI");
const ts = fc.integer({ min: 0, max: 400 }).map((d) => new Date(NOW - d * 86_400_000).toISOString().replace("Z", ""));
const hash = hex(64).map((h) => "0x" + h);
const usd = fc.integer({ min: 0, max: 5_000_000 });

const failure = <T>(): fc.Arbitrary<LookupResult<T>> =>
  fc.oneof(
    fc.constant(fail<T>("timeout", 0)),
    fc.constant(fail<T>("Internal Server Error", 500)),
    fc.constant(fail<T>("Service Unavailable", 503)),
    fc.constant(fail<T>("Too Many Requests", 429)),
    fc.constant(fail<T>("Invalid address format", 422)),
    fc.constant(fail<T>("skipped: token contract", 0)),
    fc.constant(burn422<T>()),
  );
const result = <T>(data: fc.Arbitrary<T>, okWeight = 4): fc.Arbitrary<LookupResult<T>> => fc.oneof({ arbitrary: data.map(ok), weight: okWeight }, { arbitrary: failure<T>(), weight: 1 });

const txRows = (self: string) =>
  fc.array(
    fc.record({ from: address, to: address, symbol, amount: fc.integer({ min: 1, max: 100_000 }), ts, hash, fromLabel: label, toLabel: label, dir: fc.constantFrom("in", "out", "other") }).map((o) => {
      const from = o.dir === "out" ? self : o.from,
        to = o.dir === "in" ? self : o.to;
      return txRow({ from, to, symbol: o.symbol, amount: o.amount, ts: o.ts, hash: o.hash, fromLabel: o.fromLabel, toLabel: o.toLabel });
    }),
    { maxLength: 12 },
  );
const transactions = (self: string): fc.Arbitrary<TxResponse> =>
  fc.tuple(txRows(self), fc.boolean()).map(([rows, last]) =>
    txs(
      rows.sort((a, b) => (a.block_timestamp < b.block_timestamp ? 1 : -1)),
      last,
    ),
  );
const counterparties: fc.Arbitrary<CounterpartiesResponse> = fc
  .array(
    fc.record({
      address,
      label: fc.option(fc.array(fc.constantFrom("High Activity", "Token Billionaire", "High Balance"), { maxLength: 2 }), { nil: null }),
      n: fc.integer({ min: 1, max: 500 }),
      in: usd,
      out: usd,
    }),
    { maxLength: 8 },
  )
  .map(cps);
const relations: fc.Arbitrary<RelatedWalletsResponse> = fc
  .array(fc.record({ address, relation: fc.constantFrom("Deployed by", "Created by", "First Funder", "Multisig Signer of", "Same Owner", "Funded by"), label: label }), { maxLength: 4 })
  .map(related);
const firstFunder: fc.Arbitrary<FirstFunderResponse> = fc.oneof(
  fc.constant(noFunder()),
  fc.record({ a: address, chain: fc.constantFrom("ethereum", "base"), hash }).map((o) => funder(o.a, "High Balance", o.chain, o.hash)),
);
const transfers = (self: string): fc.Arbitrary<TokenTransfer[]> =>
  fc.array(
    fc
      .record({ from: address, to: address, fromLabel: label, toLabel: label, symbol, amount: fc.integer({ min: 1, max: 100_000 }), dir: fc.constantFrom("in", "out", "other") })
      .map((o) => transfer(o.dir === "out" ? self : o.from, o.dir === "in" ? self : o.to, o.fromLabel, o.toLabel, o.symbol, o.amount)),
    { maxLength: 4 },
  );
const txLookups = (self: string): fc.Arbitrary<TxLookup[]> =>
  fc.array(
    fc.record({ hash, role: fc.constantFrom<TxLookup["role"]>("outbound", "inbound", "from-sender", "funding"), body: transfers(self), okv: fc.boolean() }).map((o) => ({
      hash: o.hash,
      role: o.role,
      result: o.okv ? ok<TxLookupResponse>(lookup(o.hash, o.body)) : fail<TxLookupResponse>("timeout", 0),
    })),
    { maxLength: 5 },
  );
const searchResp = (self: string): fc.Arbitrary<SearchResponse> =>
  fc.oneof(
    fc.constant(search()),
    fc.constantFrom(self, HOT).map((a) => search([{ address: a, symbol: "USDC", name: "USD Coin", chain: "ethereum" }])),
  );

/** A whole Lookups object: any combination of answered / failed / refused Nansen calls for one address. */
const arbLookups: fc.Arbitrary<Lookups> = fc
  .record({ self: fc.constantFrom(R, USER, "0x" + "c".repeat(40)), sender: fc.option(fc.constantFrom(SENDER, USER, HOT), { nil: undefined }), chain: fc.constantFrom("ethereum", "base") })
  .chain(({ self, sender, chain }) =>
    fc
      .record({
        search: result(searchResp(self), 6),
        transactions: result(transactions(self)),
        counterparties: result(counterparties),
        related: result(relations),
        firstFunder: result(firstFunder),
        txLookups: txLookups(self),
        senderRelated: sender ? result(relations) : fc.constant(undefined),
        transactionsWindow: fc.constantFrom<Lookups["transactionsWindow"]>("14d", "all", "14d-partial"),
      })
      .map((o): Lookups => ({ address: self, sender, chain: chain as Lookups["chain"], ...o, skipped: [] })),
  );

const ctx = (l: Lookups) => ({ address: l.address, sender: l.sender, chain: l.chain });

// ── properties ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe(`classify() — property-based, ${NUM_RUNS.toLocaleString("en-US")} generated Lookups per property`, () => {
  it(
    "P1: every input gets exactly one of the five enumerated routes, a sub-state that belongs to that route, and at least one evidence line naming a Nansen field",
    () => {
      const reached = new Map<Route, number>();
      fc.assert(
        fc.property(arbLookups, (l) => {
          const d = classify(l, NOW);
          reached.set(d.route, (reached.get(d.route) ?? 0) + 1);
          expect(ROUTES.filter((r) => r === d.route)).toHaveLength(1);
          expect(SUBS[d.route]).toContain(d.sub);
          expect(["high", "medium", "low"]).toContain(d.confidence);
          expect(d.evidence.length).toBeGreaterThan(0);
          for (const e of d.evidence) expect(e.field).toMatch(/search\/general|profiler\/address\/|transaction-with-token-transfer-lookup/);
          expect(d.rule).toBeGreaterThanOrEqual(0);
          expect(d.rule).toBeLessThanOrEqual(9);
          // and the action text always exists — the copy button is never empty
          expect(actionFor(d, ctx(l)).text.length).toBeGreaterThan(20);
        }),
        { numRuns: NUM_RUNS },
      );
      // the generator covers the whole decision space, not one corner of it (measured: all 14 route/sub-state pairs in 10,000 runs)
      for (const r of ROUTES) expect(reached.get(r) ?? 0, `route ${r} never reached`).toBeGreaterThan(50);
    },
    TIMEOUT_MS,
  );

  it(
    "P2: a failed transactions lookup never yields a stranger verdict — with no positive label, deployer or sender evidence it is `retry`, and it is never fresh/dormant/active/poisoner",
    () => {
      fc.assert(
        fc.property(arbLookups, (l) => {
          if (l.transactions.ok || isBurnRejection(l.transactions)) return; // burn is Nansen's answer, not a failure
          const d = classify(l, NOW);
          // the four stranger states are all read off the transactions page: without it they would be fabricated
          expect(d.route).not.toBe("active-stranger");
          const tokenHit = l.search.ok && l.search.data.tokens.some((t) => t.address.toLowerCase() === l.address);
          const deployer = l.related.ok && l.related.data.data.some((r) => /^(Deployed by|Created by)$/i.test(r.relation));
          const labelled = l.txLookups.some((x) => x.result.ok);
          if (!tokenHit && !deployer && !labelled && !l.sender && !isBurnRejection(l.counterparties)) {
            expect(d.route).toBe("retry");
            expect(d.rule).toBe(0);
            expect(d.evidence.map((e) => e.code)).toEqual(expect.arrayContaining([expect.stringMatching(/^(LOOKUPS_FAILED|TRANSACTIONS_FAILED)$/)]));
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  it(
    "P3: the decision hash is invariant to USD-price fields (every volume scaled by the same factor) and to warnings — dollars are display, the share is the evidence",
    () => {
      fc.assert(
        fc.property(arbLookups, fc.constantFrom(0.25, 0.5, 2, 4, 8), (l, k) => {
          if (!l.counterparties.ok) return;
          const scaled: Lookups = {
            ...l,
            counterparties: ok<CounterpartiesResponse>({
              ...l.counterparties.data,
              data: l.counterparties.data.data.map((r) => ({
                ...r,
                volume_in_usd: (r.volume_in_usd ?? 0) * k,
                volume_out_usd: (r.volume_out_usd ?? 0) * k,
                total_volume_usd: (r.total_volume_usd ?? 0) * k,
              })),
            }),
          };
          const a = classify(l, NOW),
            b = classify(scaled, NOW);
          b.warnings.push("a transient note that must not move the hash");
          expect(decisionHash(b, actionFor(b, ctx(scaled)))).toBe(decisionHash(a, actionFor(a, ctx(l))));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  it(
    "P4: classify() is pure — the same Lookups always gives the same route, sub-state and hash, and the input is not mutated",
    () => {
      fc.assert(
        fc.property(arbLookups, (l) => {
          const before = JSON.stringify(l);
          const a = classify(l, NOW),
            b = classify(l, NOW);
          expect(JSON.stringify(l)).toBe(before);
          expect([b.route, b.sub, b.confidence, b.entity ?? null]).toEqual([a.route, a.sub, a.confidence, a.entity ?? null]);
          expect(decisionHash(b, actionFor(b, ctx(l)))).toBe(decisionHash(a, actionFor(a, ctx(l))));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );
});
