# For the judge

Live version of this page: **https://sentwrong.edycu.dev/judge** (no auth, no cookies, no key).

> **Sent crypto to the wrong address? Paste it. Nansen tells you which of four recovery routes you're on — and drafts the ticket.**

## The 30-second path — no setup, no key, no clone

1. Open https://sentwrong.edycu.dev/q/0xe460774c849089ee3edf0fb06da14c066caabbef — a live verdict on a real Binance deposit address: **EXCHANGE DEPOSIT · high**, four evidence lines, each naming the Nansen endpoint and field it came from, and the prefilled Binance support ticket under **Copy**.
2. Open https://sentwrong.edycu.dev/q/0x000000000000000000000000000000000000dEaD — red **CONTRACT OR BURN**: Nansen refused the address with HTTP 422 "Burn address not allowed", and the card says not to pay anyone who promises recovery.
3. Open https://sentwrong.edycu.dev/q/0x50b37a3ec6c04609968810801531f5021929eac9 — amber **ACTIVE STRANGER · poisoner**: an address-poisoning look-alike that only ever "receives" homoglyph tokens.
4. Go to https://sentwrong.edycu.dev, click the **Binance deposit address** example and watch the ten Nansen calls land one row at a time; then **Every Nansen call (10)** opens the provenance drawer: endpoint · fields · credits · ms for every call.

Every verdict above is computed live on the server from Nansen's API when you open the link (the key stays on the server). Expect 4–13 s on a cold Vercel instance — Nansen's per-call latency varies by the minute.

## Receipts — real runs, not estimates

| | |
|---|---|
| Hero verdict, cold, live | **13 credits · 10 Nansen calls · 3.9 s** (builder, 2026-09-16 15:08 UTC) and **13 s** on an independent fresh clone (reviewer, 23:55 UTC); decision hash `3ea6cfcd752b` identical on both, and on the recorded fixture |
| Benchmark (`npm run bench`) | 13 addresses × 3 runs, every call live: **39 verdicts · 309 live calls · 396 credits · 0 non-422 failures**; cold p50 **3,157 ms** / p95 **6,477 ms**; warm (24 h cache) p50 **2 ms**, 0 credits, identical hash every run — [DEMO.md](DEMO.md) |
| Credits spent building it | ≈ 2,250 on the shared Meridian key across spike, seeds, bench, QA and screenshots (per-run client sums), plus ≈ 126 in the independent review. The 100-credit labels endpoint was called once, on purpose. |
| Tests | **212 vitest tests** in 9 s, of which **11 regression tests named after the defect they pin** (e.g. "a transactions timeout read as 'nothing on record'"), plus **13 fixtures** recorded live and replayed offline 13/13 with the same decision hash |
| Property-based verification | **40,000 generated Nansen response sets** (fast-check, 4 properties × 10,000 runs) through `classify()` — `packages/core/test/classify.property.test.ts`: exactly one of the five routes every time; a failed `transactions` lookup never becomes a stranger verdict; the decision hash is invariant to USD prices; the function is pure. All 14 route/sub-state pairs reached. |
| Boundary tests | The server key never appears in the verdict JSON, the streamed provenance, an error message or the fixtures; every malformed address is rejected with zero network calls — `packages/core/test/boundary.test.ts` (8 tests) and `e2e/key-boundary.spec.ts`, run with no key at all. |
| Timed clean clone | install 6 s · live hero verdict 13 s · offline verify 1 s · tests 3 s · dev server first 200 in 4 s (independent reviewer, two clones) |

## Reproduce — the real path

```bash
git clone https://github.com/edycutjong/sentwrong && cd sentwrong && npm install
export NANSEN_API_KEY=nsn_…            # https://app.nansen.ai/api — free tier works, this costs 13 credits
npm run sentwrong -- 0xe460774c849089ee3edf0fb06da14c066caabbef --explain
```

You get the verdict, the four evidence lines with their Nansen fields, the ticket, and the call-by-call provenance (endpoint · credits · ms · fields read). Web app: `npm run dev -w apps/web`.

**CI / deterministic replay (not the product):** `npm run verify` replays the 13 recorded fixtures with `NANSEN_OFFLINE=1` — zero network, zero credits, every decision hash must match. It exists so CI and a reader without a key can watch the engine decide; the CLI and the web app hit Nansen live by default.

## Honest limitations

1. Nansen's per-call latency varies 0.3–3 s by the minute, so a cold verdict takes 4–13 s. On Vercel the 24 h cache is in-memory per function instance — a cold start is fully live. Locally the cache is on disk.
2. "Nothing on record" cannot tell a brand-new address from one Nansen does not index: vitalik.eth returns empty profiler pages and comes back as a low-confidence *fresh* stranger. The card says so instead of promising that waiting will help.
3. Ethereum is the deeply exercised chain; the other seven EVM chains go through the same endpoints but only base has been checked live. The flagship `profiler/address/labels` endpoint (100 credits) is opt-in (`--deep`) and Smart Money endpoints are absent on purpose — the beneficiary is a person who lost money, not a trader.

## Links

- Live app: https://sentwrong.edycu.dev · this page live: https://sentwrong.edycu.dev/judge
- Repository: https://github.com/edycutjong/sentwrong — [DEMO.md](DEMO.md) (verbatim hero output + bench) · [docs/SCORING.md](docs/SCORING.md) (the decision table) · [ARCHITECTURE.md](ARCHITECTURE.md) · [docs/DX-REPORT.md](docs/DX-REPORT.md) (Nansen API friction log)
- Latest release: https://github.com/edycutjong/sentwrong/releases/latest · CI: https://github.com/edycutjong/sentwrong/actions
- Demo recording: the X post from @edycutjong tagging @nansen_ai (published at submission).
