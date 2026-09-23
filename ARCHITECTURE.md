# ARCHITECTURE.md

```
packages/core/src
  client.ts    NansenClient: POST https://api.nansen.ai/api/v1/<endpoint>, `apikey` header, 10 rps token bucket, 8 s default
               timeout, one retry on 429/5xx/timeout/dropped connection (Retry-After honoured, ≤ 3 s), a Call record per
               request (endpoint, body, credits, ms, attempts, cached, ok/error, sha256 of the raw body, fieldsUsed) — the
               provenance drawer is this log verbatim.
  cache.ts     CachedNansenClient: read-through cache keyed by sha256(endpoint + canonical body), 24 h TTL, hits recorded
               at 0 credits, NANSEN_OFFLINE=1 replay mode, 400/422 rejections cached too (a 422 burn is data; 401/402/403
               account errors never are), a non-JSON 200 is one failed call and never stored.
  nansen.ts    typed request/response shapes per docs.nansen.ai openapi.json, one function per endpoint, each declaring
               the fields the engine reads. `recentWindow(now)` = 14 days, `ALL_TIME` = 2015-07-30..2030-01-01.
  labels.ts    parseLabel("🏦 Binance: Deposit [0xe46077]") → {entity: "Binance", role: "Deposit", exchange: true};
               isDepositLabel, isContractLabel, isSpoofSymbol (homoglyph tickers), lookAlike (same first/last hex).
  lookups.ts   gather(): all I/O. Stage 0 search/general (token contract → stop, 0 credits). Stage 1 transactions (14 d),
               related-wallets, first-funder in parallel. Stage 2 all-time transactions + counterparties for quiet
               addresses (14-day counterparties for busy ones; a failed all-time page → window "14d-partial"), sender's
               related-wallets. Stage 3 transaction lookups on the 2 newest outbound, the newest inbound (or the sender's
               transfer) and the funding tx. Every failure is a value, never an exception; --deep adds
               profiler/address/labels (100 credits).
  classify.ts  pure decision table (docs/SCORING.md): Lookups → {route, sub, confidence, entity, headline, evidence[], warnings[]}.
  text.ts      the copy button: ticket / checklist / memo / note from the decision + the sender's transfer if seen.
  verdict.ts   sentWrong(): gather → classify → text; rows (counterparties with entity labels merged in), transfer,
               provenance, credits, decision hash = sha256(route, sub, confidence, entity, evidence codes+values, action text).
  fixtures.ts  record/replay: every raw response a verdict touched + the verdict + `now`.
packages/cli   sentwrong <address> [--from] [--chain] [--json] [--explain] [--deep] [--no-cache]
apps/web       Next.js 15: / (input → live call rows → verdict card → copy), /api/verdict (NDJSON stream of the call log
               then the verdict; key server-side; in-memory 24 h cache per instance, 5,000 responses max), /q/[address]
               (share page, a live verdict on every GET), /api/og (route-coloured card). lib/guard.ts admit() gates both
               live surfaces before any Nansen call: 6/min per IP, 3,000 credits/day.
scripts        spike.ts (day-one probe) · seed.ts (record fixtures live) · verify.ts (replay offline, exit 1 on drift) ·
               bench.ts (cold/warm p50/p95, credits per verdict, hash equality) · check_submission_readiness.ts
fixtures/      13 recorded live runs (real Nansen responses, byte-for-byte, no key material)
```

## One verdict, cold (the hero, 13 credits, 10 calls, ~3–5 s)
```
search/general                          0 cr   token at this address? no
profiler/address/transactions (14 d)    1 cr   page not full → quiet address
profiler/address/related-wallets        1 cr   First Funder 0x9430… (no deployer)
profiler/address/first-funder           1 cr   0x9430… tx 0x…
profiler/address/transactions (all)     1 cr   37 rows: 22 in / 15 out, all 15 out → 0x28c6…
profiler/address/counterparties (all)   5 cr   volume_out 100 % → 0x28c6…
transaction lookup ×2 (newest sweeps)   2 cr   "🏦 Binance: Deposit [0xe46077]" → "🏦 Binance 14 [0x28c6c0]"
transaction lookup (newest inbound)     1 cr   "High Activity [0x16c794]" → "🏦 Binance: Deposit"
transaction lookup (funding tx)         1 cr   "🏦 Binance [0x943080]" → 0xe460…
→ rule 3: exchange-deposit · direct-label · high · Binance
```
Warm (same inputs within 24 h): 10 cached calls, 0 credits, ~1 ms, identical hash.

## Honesty rules baked in
- A verdict never comes from zero successful lookups (`retry`).
- Failed calls are in the provenance with their error and attempt count; cached calls say cached.
- The fixtures are replays of real responses and are labelled as such; the CLI and web default to live.
- The 100-credit labels call is never automatic; its cost is printed before it runs and its (dis)agreement is shown.
