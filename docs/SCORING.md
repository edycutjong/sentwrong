# SCORING.md — how Sent Wrong decides the route

There is no score: the verdict is a **decision table** (`packages/core/src/classify.ts`), evaluated top to bottom, first match wins. Every condition is a Nansen response field, and every evidence line on the card names the endpoint and field it came from. The numbers below are from the recorded fixtures (`fixtures/*.json`, live 2026-09-16).

## The table

| # | Condition (Nansen field) | Route · state | Confidence | Evidence code | Fixture that hits it |
|---|---|---|---|---|---|
| 1 | `profiler/address/transactions` or `counterparties` → **HTTP 422 `Burn address not allowed`** | contract-or-burn · burn | high | `BURN_422` | `0x…dEaD` |
| 2 | `search/general` → `tokens[].address == recipient` and `tokens[].chain == the chain asked about` (search is chain-agnostic; review 2026-09-17) | contract-or-burn · token-contract | high | `TOKEN_CONTRACT` | USDC `0xa0b8…eb48` (0 credits, 1 call) |
| 3 | `transaction-with-token-transfer-lookup` → `token_transfer_array[].from/to_address_label` of the recipient matches `^<Entity>: Deposit$` | exchange-deposit · direct-label | high | `OWN_DEPOSIT_LABEL` (+ `SWEEP_TO_EXCHANGE`, `OUTFLOW_CONCENTRATED`, `FUNDED_BY_EXCHANGE` as corroboration) | `0xe460…bbef` → "🏦 Binance: Deposit", 100 % of $2,953 out to Binance 14, gas from "🏦 Binance [0x943080]" |
| 3b | the recipient's own label carries Nansen's 🏦 marker, is not a deposit label and not a contract label, and no deployer exists | exchange-deposit · exchange-wallet | high | `OWN_EXCHANGE_LABEL` | (unit test: Binance 14 itself) |
| 4 | ≥1 outbound transfer and **every** looked-up destination label is 🏦-marked, not a `: Deposit` label, not a contract label | exchange-deposit · sweep-pattern | medium → high if `first-funder` label is the same exchange or `counterparties.volume_out_usd` share ≥ 0.95 | `SWEEP_TO_EXCHANGE`, `FUNDED_BY_EXCHANGE`, `OUTFLOW_CONCENTRATED` | `0x6465…e0e2` (Coinbase deposit address minutes old, no own label yet) |
| 5 | `related-wallets.relation` ∈ {Deployed by, Created by} or own label contains Contract / Router / Proxy / Pool / …Token | contract-or-burn · contract, or · forwarder when every outbound goes to one named custodian *wallet* (a labelled pool/router destination is a swap, not custody — the Uniswap V3 SwapRouter stays `contract`) | high (deployer) / medium | `DEPLOYED_BY`, `CONTRACT_LABEL`, `FORWARDS_TO_CUSTODIAN` | Uniswap V2 router (Deployed by 0x9c33… 2020-06-05); `0xfcfd…a69c` forwarder → "🤖 BitGo MultiSig" |
| 6 | sender given (and not itself an exchange wallet) and: recipient ∈ `related-wallets(sender)`, or `first-funder(recipient) == sender`, or sender ∈ `related-wallets(recipient)` | your-own-wallet · related / funded | high | `RELATED_TO_SENDER`, `FUNDED_BY_SENDER` | `0x3ff4…62b0 --from 0xb0ae…03b5` (First Funder) |
| 7 | `transactions.data` empty (all-time, HTTP 200) | active-stranger · fresh — the headline says Nansen may simply not index the address (vitalik.eth returns empty profiler pages) | low | `NO_HISTORY` | `0xd8da…c6ba` (live QA 2026-09-16, 0 rows on every profiler endpoint) |
| 8 | ≥2 inbound transfers with a homoglyph/digit-swap `token_symbol` (≥ half of inbound) and 0 outbound | active-stranger · poisoner | high | `SPOOF_TOKEN_TRANSFERS` | `0x50b3…eac9` ("ÚЅDТ" ×3) |
| 9 | 0 outbound ever | active-stranger · dormant | low | `ACTIVITY`, `FUNDED_BY_EXCHANGE`, `COUNTERPARTIES` | `0x4004…a02c` (1 in / 0 out, first-funder empty) |
| 10 | otherwise; last outbound ≤ 90 days → medium | active-stranger · active | medium / low | `ACTIVITY`, `DEPOSITS_INTO_EXCHANGE`, … | `0x3ff4…62b0` |
| — | transactions, counterparties **and** related-wallets all failed (non-422) | **retry** — no verdict | — | `LOOKUPS_FAILED` | (unit test) |
| — | `transactions` failed (timeout / 5xx) and no rule above fired | **retry** — no verdict: the stranger states are read off the transactions page, so a timeout must never become "nothing on record" | — | `TRANSACTIONS_FAILED` | (unit test) |

Warnings are attached, never hidden: failed lookups with their error, "only one sweep seen", look-alike counterparties (address poisoning), "your address is an exchange wallet", a `--deep` disagreement.

## Why this order
- Burn and token contract first because they are cheapest (0–1 credits) and end the search before profiler calls.
- Exchange evidence (3, 3b, 4) outranks the contract flag (5) because exchanges issue *forwarder contracts* as deposit addresses (`createForwarder`).
- A `: Deposit` label on a **destination** is excluded from rule 4: that is a person depositing into an exchange, not a sweep (live regression, fixture 11).
- 🏦 alone is not "exchange": Nansen marks DEX routers with it too ("🤖 🏦 Uniswap: V2 Router 2"), so contract labels are excluded from 3b and 4.
- Own-wallet (6) needs the sender and comes after contract detection because "you deployed it" is still a contract.

## What the data taught us (spike, 2026-09-16)
- The 1–5-credit profiler label fields (`counterparty_address_label`, `first_funder_name`, `address_label`) carry wealth/activity tags only: Binance 14 is `["Token Billionaire"]`, Coinbase 10 `["High Activity"]`. The entity label "Binance" lives in the 100-credit `profiler/address/labels` — **and** in `transaction-with-token-transfer-lookup.token_transfer_array[].*_address_label` for 1 credit, where user-level deposit addresses read "🏦 Binance: Deposit". The whole engine hangs on that field.
- `profiler/address/transactions` with an all-time date range makes Nansen return 500 after 30 s on the Uniswap router; a 14-day window answers in ≤ 6 s on the USDT contract and Binance 14. Hence the two-stage window (`lookups.ts`).
- Burn addresses are refused with a 422 — the refusal is the signal.
- `first-funder` returns `data: []` for wallets that never received native gas (a fresh withdrawal recipient): documented, and handled as "no funder", not an error.
- Address poisoning is visible in two Nansen fields: look-alike `counterparty_address` values (same first/last hex) and inbound `token_symbol` values with homoglyphs ("ÚЅDТ", "U5DТ") that `hide_spam_token: true` does not filter.

## Decision hash
`sha256({route, sub, confidence, entity, evidence[code, value], action.text})` — timing, credits, cache state and warnings are excluded. `npm run verify` replays every fixture offline and requires the same hash; `npm run bench` checks that a warm (cached) verdict has the same hash as the cold one.
