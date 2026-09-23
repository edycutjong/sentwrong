# DEMO.md — the 30-second demo, and the numbers behind it

## The recording (muted, captions only)

| t | On screen |
|---|---|
| 0 s | paste `0xe460774c849089ee3edf0fb06da14c066caabbef`, caption "I sent 316 USDT here by mistake" |
| 3 s | rows appear as Nansen answers: `search/general` 0 cr · `profiler/address/transactions` · `related-wallets` · `first-funder` · `counterparties` 5 cr · four `transaction-with-token-transfer-lookup` |
| 8 s | verdict card slides in: **EXCHANGE DEPOSIT · high** — "This is a Binance deposit address. Recoverable through Binance support." with the four evidence lines (`🏦 Binance: Deposit [0xe46077]` → `🏦 Binance 14`, 100 % outflow to one counterparty, gas from `🏦 Binance`) |
| 16 s | click **Copy** on the prefilled Binance ticket |
| 22 s | paste `0x000000000000000000000000000000000000dEaD` → red **CONTRACT OR BURN** — "Funds sent here are gone. Do not pay anyone who promises recovery." Evidence: `profiler/address/transactions → HTTP 422 = Burn address not allowed` |
| 32 s | paste `0x50b37a3ec6c04609968810801531f5021929eac9` → amber **ACTIVE STRANGER · poisoner** — "address-poisoning scam address: only ever 'receives' fake tokens (ÚЅDТ)" |
| 42 s | open the provenance drawer: 10 calls · 13 credits · every field named |

Everything on screen is live; a rehearsal warms the 24 h cache, so if Nansen is slow on the day the rows still resolve (they say "cached"). Record against `npm run dev -w apps/web` on localhost: there the cache is on disk and survives restarts. On the Vercel deployment the cache is in-memory per function instance — a cold start begins empty and every call is live again (measured 2026-09-16: three back-to-back API hits were 13 → 0 → 0 credits, but a permalink render five seconds earlier had not warmed the API route's instance).

## The hero query, real output (2026-09-16 15:08 UTC, `npm run sentwrong -- 0xe460774c849089ee3edf0fb06da14c066caabbef --explain --no-cache`, verbatim)

```
0xe460774c849089ee3edf0fb06da14c066caabbef on ethereum
counterparties (profiler/address/counterparties, labels via transaction lookups):
  0x16c7…c41f  High Activity                      ×  20  in $      2,763  out $          0
  0x28c6…1d60  🏦 Binance 14 [0x28c6c0]           ×  15  in $          0  out $      2,953
  0x00fe…8c23  —                                  ×   1  in $        190  out $          0
  0x9430…daf8  🏦 Binance [0x943080]              ×   1  in $          5  out $          0

EXCHANGE-DEPOSIT (high · direct-label)
This is a Binance deposit address. Recoverable through Binance support.
  ✔ Nansen has this exact address labelled as a Binance customer deposit address.
    transaction-with-token-transfer-lookup → token_transfer_array[].from_address_label = 🏦 Binance: Deposit [0xe46077]
  ✔ Everything it receives is swept into Binance's own wallet.
    transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label = 🏦 Binance 14 [0x28c6c0]
  ✔ All outflow ($2,953 at today's prices) goes to one counterparty: the sweep pattern of a deposit address.
    profiler/address/counterparties → volume_out_usd = 100% to 0x28c6…1d60
  ✔ Binance paid this address's first gas — exchanges do that for their deposit addresses.
    profiler/address/first-funder → first_funder_address (looked up) = 🏦 Binance [0x943080]

Support ticket for Binance
────────────────────────────────────────────────────────────
Subject: Funds sent to a Binance deposit address by mistake — recovery request

Hello Binance support,

On [date] I sent [amount and token] from my wallet [your address] to 0xe460774c849089ee3edf0fb06da14c066caabbef on ethereum (transaction [transaction hash]).

This was a mistake. 0xe460774c849089ee3edf0fb06da14c066caabbef is a Binance customer deposit address — Nansen labels it "🏦 Binance: Deposit [0xe46077]" and its transfers are swept into Binance's own wallets. It may belong to another Binance customer, or to an old account of mine. Please locate the account that owns this deposit address and either credit the funds to it (if it is mine) or return them to [your address].

Evidence (Nansen API):
- transaction-with-token-transfer-lookup → token_transfer_array[].from_address_label: 🏦 Binance: Deposit [0xe46077]
- transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label: 🏦 Binance 14 [0x28c6c0]
- profiler/address/counterparties → volume_out_usd: 100% to 0x28c6…1d60
- profiler/address/first-funder → first_funder_address (looked up): 🏦 Binance [0x943080]

Account email: [your Binance account email]
Thank you,
[your name]
────────────────────────────────────────────────────────────
rule 3 fired · decision hash 3ea6cfcd752bc589ad424a5d3b0431c3631ad70a3b11ed1e64e8df12a1185027
   live search/general                             0 cr   591 ms  fields: tokens[].address, tokens[].chain, entities[].name
   live profiler/address/first-funder              1 cr   373 ms  fields: data[].first_funder_address, data[].first_funder_name, data[].transaction_hash
   live profiler/address/related-wallets           1 cr   548 ms  fields: data[].address, data[].relation, data[].address_label
   live profiler/address/transactions              1 cr   738 ms  fields: data[].method, data[].tokens_sent[].to_address, data[].tokens_received[].from_address, data[].block_timestamp, data[].transaction_hash
   live profiler/address/counterparties            5 cr   333 ms  fields: data[].counterparty_address, data[].counterparty_address_label, data[].interaction_count, data[].volume_in_usd, data[].volume_out_usd
   live profiler/address/transactions              1 cr   919 ms  fields: data[].method, data[].tokens_sent[].to_address, data[].tokens_received[].from_address, data[].block_timestamp, data[].transaction_hash
   live transaction-with-token-transfer-lookup     1 cr   657 ms  fields: data[].to_address_label, data[].token_transfer_array[].to_address_label, data[].token_transfer_array[].from_address_label
   live transaction-with-token-transfer-lookup     1 cr   802 ms  fields: data[].to_address_label, data[].token_transfer_array[].to_address_label, data[].token_transfer_array[].from_address_label
   live transaction-with-token-transfer-lookup     1 cr  1121 ms  fields: data[].to_address_label, data[].token_transfer_array[].to_address_label, data[].token_transfer_array[].from_address_label
   live transaction-with-token-transfer-lookup     1 cr  1634 ms  fields: data[].to_address_label, data[].token_transfer_array[].to_address_label, data[].token_transfer_array[].from_address_label
13 credits · 10 calls (0 cached) · 3.9s · verdict 3ea6cfcd752b
```

A second `--no-cache` run 45 s later: `13 credits · 10 calls (0 cached) · 3.9s · verdict 3ea6cfcd752b` — same hash. (`volume_out_usd` is priced at current rates and drifts by the minute, so the hashed evidence value is the outflow *share*, not the dollars.)

## Benchmark — `npm run bench` (13 addresses × 3 runs, live, 2026-09-16 15:0x UTC)

```
verdicts: 39 (13 addresses × 3 runs) · routes: exchange-deposit 15, contract-or-burn 12, active-stranger 9, your-own-wallet 3
cold  p50 3157 ms · p95 6477 ms · max 10567 ms
warm  p50 2 ms · p95 5 ms · max 7 ms
credits/verdict  mean 10.2 · min 0 · max 13 · total 396
calls/verdict    mean 7.9 · live calls made 309 · non-422 failures 0
warm verdicts: 0 credits, 0 network calls, identical decision hash (checked every run)
```

Per address, run 1 (cold = fresh in-memory cache, every call live; warm = same verdict again):

```
run 1 0xe460774c…  exchange-deposit  cold   5175 ms  warm    2 ms  13 cr / 10 calls
run 1 0x321019b0…  exchange-deposit  cold   6765 ms  warm    6 ms  13 cr / 10 calls
run 1 0x5523aec7…  exchange-deposit  cold   4580 ms  warm    5 ms  12 cr / 9 calls
run 1 0x6465f379…  exchange-deposit  cold   5242 ms  warm    4 ms  11 cr / 8 calls
run 1 0x42fbcba0…  exchange-deposit  cold   3142 ms  warm    3 ms  13 cr / 10 calls
run 1 0xfcfd0735…  contract-or-burn  cold   5898 ms  warm    1 ms  11 cr / 8 calls
run 1 0x00000000…  contract-or-burn  cold   1242 ms  warm    1 ms  2 cr / 5 calls
run 1 0xa0b86991…  contract-or-burn  cold    391 ms  warm    0 ms  0 cr / 1 calls
run 1 0x7a250d56…  contract-or-burn  cold  10567 ms  warm    4 ms  11 cr / 8 calls
run 1 0x4004000c…  active-stranger   cold   2560 ms  warm    2 ms  10 cr / 7 calls
run 1 0x3ff462b1…  active-stranger   cold   6012 ms  warm    0 ms  13 cr / 10 calls
run 1 0x3ff462b1… --from  your-own-wallet   cold   3209 ms  warm    2 ms  13 cr / 10 calls
run 1 0x50b37a3e…  active-stranger   cold   6477 ms  warm    2 ms  10 cr / 7 calls
```

Cold = a fresh in-memory cache per verdict, every call live. Warm = the same verdict again from cache. The max (10.6 s) is the Uniswap V2 router on run 1 — the busiest address in the set, where one 14-day `transactions` page hit the 10 s cap and was retried; runs 2 and 3 took 3.6 s and 3.4 s. Before the two-stage date window that address took 23 s every time.

## Reproduce

```bash
export NANSEN_API_KEY=nsn_…
npm install
npm run sentwrong -- 0xe460774c849089ee3edf0fb06da14c066caabbef --explain   # the hero, live, 13 credits
npm run verify                                                              # 13/13 fixtures replay offline, 0 credits
npm run bench -- --runs 1                                                   # ~130 credits; --runs 3 for the table above
npm test                                                                    # 231 tests
```
