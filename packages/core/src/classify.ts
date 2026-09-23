/**
 * The decision table (docs/SCORING.md). Pure: Lookups in, Verdict decision out. Every term is a Nansen response field;
 * the evidence list says which field, what it said, and what that means. First matching rule wins.
 */
import { isBurnRejection, splitDirection, type Lookups, type TxLookup } from "./lookups.js";
import { parseLabel, isDepositLabel, isContractLabel, isSpoofSymbol, lookAlike, type ParsedLabel } from "./labels.js";
import type { TokenTransfer, TxRow } from "./nansen.js";

export type Route = "exchange-deposit" | "your-own-wallet" | "active-stranger" | "contract-or-burn" | "retry";
export type Confidence = "high" | "medium" | "low";
export type Evidence = {
  /** stable code — the hash and the tests key on these */
  code: string;
  /** the Nansen endpoint + field the term came from */
  field: string;
  /** the value as Nansen returned it (stringified, short) */
  value: string;
  /** one line a non-crypto person can read */
  meaning: string;
};
export type Decision = {
  route: Route;
  /** finer state inside a route: burn | token-contract | contract | direct-label | sweep-pattern | related | funded | fresh | dormant | active */
  sub: string;
  confidence: Confidence;
  /** exchange / protocol / token name when known */
  entity?: string;
  headline: string;
  evidence: Evidence[];
  /** what the decision was made from, in rule order, for --explain */
  rule: number;
  /** honest notes: failed lookups, low coverage, disagreements */
  warnings: string[];
};

const lc = (s: string) => s.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** All transfers seen through transaction lookups, tagged with the lookup role. */
function transfers(l: Lookups): Array<{ t: TokenTransfer; role: TxLookup["role"]; hash: string }> {
  const out: Array<{ t: TokenTransfer; role: TxLookup["role"]; hash: string }> = [];
  for (const x of l.txLookups) if (x.result.ok) for (const row of x.result.data.data) for (const t of row.token_transfer_array ?? []) out.push({ t, role: x.role, hash: x.hash });
  return out;
}

/** Labels Nansen attached to the address itself (as a transfer party), de-duplicated by text. */
export function ownLabels(l: Lookups): ParsedLabel[] {
  const seen = new Map<string, ParsedLabel>();
  for (const { t } of transfers(l)) {
    const raw = lc(t.from_address) === l.address ? t.from_address_label : lc(t.to_address) === l.address ? t.to_address_label : undefined;
    const p = parseLabel(raw);
    if (p && !seen.has(p.text)) seen.set(p.text, p);
  }
  return [...seen.values()];
}

/** Destinations of the address's own outbound transfers, with their labels (from outbound lookups only). */
export function outboundDestinations(l: Lookups): Array<{ address: string; label?: ParsedLabel; raw?: string | null }> {
  const seen = new Map<string, { address: string; label?: ParsedLabel; raw?: string | null }>();
  for (const { t, role } of transfers(l)) {
    if (role !== "outbound" || lc(t.from_address) !== l.address) continue;
    const to = lc(t.to_address);
    if (!seen.has(to)) seen.set(to, { address: to, label: parseLabel(t.to_address_label), raw: t.to_address_label });
  }
  return [...seen.values()];
}

export function funderLabel(l: Lookups): ParsedLabel | undefined {
  const ff = l.firstFunder.ok ? l.firstFunder.data.data[0] : undefined;
  if (!ff) return undefined;
  for (const { t, role } of transfers(l)) if (role === "funding" && lc(t.from_address) === lc(ff.first_funder_address)) return parseLabel(t.from_address_label);
  return undefined;
}

/** Share of all-time outflow (USD) that went to the single biggest destination — 1.0 is the sweep signature. */
export function outflowConcentration(l: Lookups): { share: number; to?: string; totalOut: number } {
  if (!l.counterparties.ok) return { share: 0, totalOut: 0 };
  const rows = l.counterparties.data.data;
  const totalOut = rows.reduce((n, r) => n + (r.volume_out_usd ?? 0), 0);
  const top = [...rows].sort((a, b) => (b.volume_out_usd ?? 0) - (a.volume_out_usd ?? 0))[0];
  if (!top || totalOut <= 0) return { share: 0, totalOut };
  // top is the row with the largest (volume_out_usd ?? 0); if top's own field were nullish (normalizing to 0) and it is
  // still the max, every row normalizes to ≤ 0, which forces totalOut ≤ 0 and returns on the line above — so top's
  // field is provably non-nullish here; asserted rather than defaulted, leaving no dead branch behind.
  return { share: top.volume_out_usd! / totalOut, to: top.counterparty_address, totalOut };
}

export function activity(l: Lookups, now: number) {
  if (!l.transactions.ok) return undefined;
  const rows: TxRow[] = l.transactions.data.data;
  const { outbound, inbound } = splitDirection(rows, l.address);
  const newest = rows[0]?.block_timestamp, oldest = rows.at(-1)?.block_timestamp;
  const lastOut = outbound[0]?.block_timestamp;
  const daysSince = (ts?: string) => (ts ? Math.floor((now - Date.parse(ts.endsWith("Z") ? ts : ts + "Z")) / 86_400_000) : undefined);
  return { rows: rows.length, out: outbound.length, in: inbound.length, newest, oldest, lastOut, daysSinceNewest: daysSince(newest), daysSinceLastOut: daysSince(lastOut), truncated: !l.transactions.data.pagination.is_last_page };
}

export function classify(l: Lookups, now = Date.now()): Decision {
  const ev: Evidence[] = [];
  const warnings: string[] = [];
  const failed = (name: string, r: { ok: boolean; error?: string; status?: number } | undefined) => {
    if (r && !r.ok && !isBurnRejection(r as never) && !String(r.error).startsWith("skipped")) warnings.push(`${name} failed: ${r.error}${r.status ? ` (HTTP ${r.status})` : ""}`);
  };
  failed("transactions", l.transactions); failed("counterparties", l.counterparties); failed("related-wallets", l.related); failed("first-funder", l.firstFunder);
  for (const x of l.txLookups) if (!x.result.ok) warnings.push(`transaction lookup ${x.hash.slice(0, 10)}… (${x.role}) failed: ${x.result.error}`);

  // 1. burn — Nansen refuses the address outright
  if (isBurnRejection(l.transactions) || isBurnRejection(l.counterparties)) {
    const src = isBurnRejection(l.transactions) ? "profiler/address/transactions" : "profiler/address/counterparties";
    ev.push({ code: "BURN_422", field: `${src} → HTTP 422`, value: "Burn address not allowed", meaning: "Nansen classifies this as a burn address: nothing sent here can be moved by anyone." });
    return { route: "contract-or-burn", sub: "burn", confidence: "high", headline: "This is a burn address. Funds sent here are gone.", evidence: ev, rule: 1, warnings };
  }
  // 2. token contract
  if (l.search.ok) {
    const hit = l.search.data.tokens.find((t) => lc(t.address) === l.address && lc(t.chain) === l.chain);
    if (hit) {
      ev.push({ code: "TOKEN_CONTRACT", field: "search/general → tokens[].address", value: `${hit.symbol} (${hit.name}) on ${hit.chain}`, meaning: `This address is the ${hit.symbol} token contract itself, not a wallet.` });
      return { route: "contract-or-burn", sub: "token-contract", confidence: "high", entity: hit.symbol, headline: `This is the ${hit.symbol} token contract. Tokens sent to a token contract cannot be withdrawn.`, evidence: ev, rule: 2, warnings };
    }
  }
  const own = ownLabels(l);
  const dests = outboundDestinations(l);
  const funder = funderLabel(l);
  const conc = outflowConcentration(l);
  const act = activity(l, now);
  const relations = l.related.ok ? l.related.data.data : [];

  // a user wallet that deposits into an exchange: outbound goes to "<X>: Deposit" addresses (used by rule 9's text)
  const depositsInto = dests.filter((d) => isDepositLabel(d.label)).map((d) => d.label!.entity);
  // 3. Nansen labels the address itself as "<Exchange>: Deposit"
  const dep = own.find(isDepositLabel);
  if (dep) {
    ev.push({ code: "OWN_DEPOSIT_LABEL", field: "transaction-with-token-transfer-lookup → token_transfer_array[].from_address_label", value: dep.raw, meaning: `Nansen has this exact address labelled as a ${dep.entity} customer deposit address.` });
    const ex = dests.filter((d) => d.label?.exchange);
    if (ex.length) ev.push({ code: "SWEEP_TO_EXCHANGE", field: "transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label", value: ex.map((d) => d.label!.raw).join(" · "), meaning: `Everything it receives is swept into ${dep.entity}'s own wallet.` });
    // the USD total is priced at current rates and drifts by the minute; the hashed value is the share, the dollars are display
    if (conc.share >= 0.95 && conc.to) ev.push({ code: "OUTFLOW_CONCENTRATED", field: "profiler/address/counterparties → volume_out_usd", value: `${Math.round(conc.share * 100)}% to ${short(conc.to)}`, meaning: `All outflow ($${Math.round(conc.totalOut).toLocaleString("en-US")} at today's prices) goes to one counterparty: the sweep pattern of a deposit address.` });
    if (funder?.exchange) ev.push({ code: "FUNDED_BY_EXCHANGE", field: "profiler/address/first-funder → first_funder_address (looked up)", value: funder.raw, meaning: `${funder.entity ?? "The exchange"} paid this address's first gas — exchanges do that for their deposit addresses.` });
    return { route: "exchange-deposit", sub: "direct-label", confidence: "high", entity: dep.entity, headline: `This is a ${dep.entity} deposit address. Recoverable through ${dep.entity} support.`, evidence: ev, rule: 3, warnings };
  }
  // 3b. the address IS an exchange's own wallet ("🏦 Binance 14", "🏦 Kraken: Hot Wallet") — pooled funds, only the exchange can act
  //     🏦 also marks DEX routers ("🤖 🏦 Uniswap: V2 Router 2"): a contract label or a deployer means rule 5, not this
  const deployedRel = relations.find((r) => /^(Deployed by|Created by)$/i.test(r.relation));
  const exWallet = own.find((p) => p.exchange && p.entity && !isDepositLabel(p) && !isContractLabel(p));
  if (exWallet && !deployedRel) {
    ev.push({ code: "OWN_EXCHANGE_LABEL", field: "transaction-with-token-transfer-lookup → token_transfer_array[].*_address_label", value: exWallet.raw, meaning: `Nansen labels this exact address as ${exWallet.entity}'s own wallet (${exWallet.role ?? "hot wallet"}).` });
    if (act) ev.push({ code: "ACTIVITY", field: "profiler/address/transactions → data[]", value: `${act.in} in / ${act.out} out in the newest ${act.rows} rows${act.truncated ? " (busy: 14-day page full)" : ""}`, meaning: "Exchange wallets move funds constantly; yours is pooled with everyone else's." });
    return { route: "exchange-deposit", sub: "exchange-wallet", confidence: "high", entity: exWallet.entity, headline: `This is ${exWallet.entity}'s own wallet, not a customer deposit address. Only ${exWallet.entity} support can credit or return funds sent here — quote your transaction hash.`, evidence: ev, rule: 3, warnings };
  }
  // 4. sweep pattern: every outbound destination we looked up is an exchange's OWN wallet (hot/cold wallet, "Binance 14") —
  //    a destination labelled "<X>: Deposit" is someone depositing INTO the exchange, i.e. a user wallet, not a sweep
  //    and a 🏦-marked DEX router ("Uniswap: V2 Router 2") is a swap, not a sweep — contract labels are excluded
  //    and a deposit address sweeps into ONE exchange: outflow split across several exchanges' wallets is a person's pattern
  const sweepTarget = (d: { label?: ParsedLabel }) => !!d.label?.exchange && !isDepositLabel(d.label) && !isContractLabel(d.label);
  const sweepEntities = [...new Set(dests.map((d) => d.label?.entity))];
  if (dests.length && dests.every(sweepTarget) && sweepEntities.length > 1) warnings.push(`its outbound goes to several exchanges' own wallets (${sweepEntities.join(", ")}) — not the single-exchange sweep of a deposit address`);
  if (dests.length && dests.every(sweepTarget) && sweepEntities.length === 1) {
    const entity = dests[0].label!.entity ?? "an exchange";
    ev.push({ code: "SWEEP_TO_EXCHANGE", field: "transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label", value: dests.map((d) => d.label!.raw).join(" · "), meaning: `Every transfer out of this address went to ${entity}'s own wallet — it is swept like a deposit address.` });
    let confidence: Confidence = "medium";
    if (funder?.exchange && funder.entity === dests[0].label!.entity) { confidence = "high"; ev.push({ code: "FUNDED_BY_EXCHANGE", field: "profiler/address/first-funder → first_funder_address (looked up)", value: funder.raw, meaning: `${entity} also paid its first gas.` }); }
    if (conc.share >= 0.95 && conc.to) { confidence = "high"; ev.push({ code: "OUTFLOW_CONCENTRATED", field: "profiler/address/counterparties → volume_out_usd", value: `${Math.round(conc.share * 100)}% to ${short(conc.to)}`, meaning: `All outflow ($${Math.round(conc.totalOut).toLocaleString("en-US")} at today's prices) goes to one counterparty.` }); }
    if (act && act.out < 2) warnings.push("only one sweep seen so far — the address is new; the pattern is consistent but thin");
    return { route: "exchange-deposit", sub: "sweep-pattern", confidence, entity, headline: `This looks like a ${entity} deposit address (not labelled yet, but swept into ${entity}). Recoverable through ${entity} support.`, evidence: ev, rule: 4, warnings };
  }
  // 5. contract
  const deployed = deployedRel;
  const cl = own.find(isContractLabel);
  if (deployed || cl) {
    if (deployed) ev.push({ code: "DEPLOYED_BY", field: "profiler/address/related-wallets → relation", value: `${deployed.relation} ${short(deployed.address)}${deployed.address_label ? ` (${deployed.address_label})` : ""} on ${deployed.block_timestamp.slice(0, 10)}`, meaning: "Only contracts have a deployer: this address is code, not a person's wallet." });
    if (cl) ev.push({ code: "CONTRACT_LABEL", field: "transaction-with-token-transfer-lookup → token_transfer_array[].*_address_label", value: cl.raw, meaning: "Nansen's label for this address names a contract." });
    // a forwarder: a contract whose outflow goes to a named custodian (BitGo MultiSig, an exchange's cold wallet…) — whoever
    // issued the address can trace the deposit, so it is not "gone", it is "ask the service that gave you this address"
    // — but only a custody WALLET counts: a DEX router's outflow lands in labelled pools/routers ("Uniswap: V3 USDC-WETH
    // Liquidity Pool"), which is a swap, not custody (live QA 2026-09-16: the V3 SwapRouter was read as a "forwarder")
    const custodian = dests.find((d) => d.label?.entity && !d.label.generic && !isContractLabel(d.label));
    if (deployed && custodian && dests.every((d) => d.label?.entity === custodian.label!.entity && !isContractLabel(d.label))) {
      ev.push({ code: "FORWARDS_TO_CUSTODIAN", field: "transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label", value: custodian.label!.raw, meaning: `Everything sent here is forwarded to ${custodian.label!.entity}'s custody wallet — the service that issued this address can trace it.` });
      return { route: "contract-or-burn", sub: "forwarder", confidence: "medium", entity: custodian.label!.entity, headline: `A forwarding contract that sweeps into ${custodian.label!.entity} custody. Contact the exchange or service that gave you this address — they can trace the deposit. Not a recovery service.`, evidence: ev, rule: 5, warnings };
    }
    const entity = cl?.entity;
    return { route: "contract-or-burn", sub: "contract", confidence: deployed ? "high" : "medium", entity, headline: `This is a smart contract${entity ? ` (${entity})` : ""}, not a wallet. Unless its owner has a recovery function, funds sent here cannot be returned.`, evidence: ev, rule: 5, warnings };
  }
  // 6. your own wallet — unless "your address" is itself an exchange wallet (then the first-funder link means nothing)
  const senderIsExchange = l.sender ? transfers(l).some(({ t }) => (lc(t.from_address) === l.sender && parseLabel(t.from_address_label)?.exchange) || (lc(t.to_address) === l.sender && parseLabel(t.to_address_label)?.exchange)) : false;
  if (l.sender && senderIsExchange) warnings.push("the address you gave as yours is labelled as an exchange wallet by Nansen — the own-wallet check was skipped");
  if (l.sender && !senderIsExchange) {
    const viaSender = l.senderRelated?.ok ? l.senderRelated.data.data.find((r) => lc(r.address) === l.address) : undefined;
    const ff = l.firstFunder.ok ? l.firstFunder.data.data[0] : undefined;
    const fundedBySender = ff && lc(ff.first_funder_address) === l.sender;
    const viaRecipient = relations.find((r) => lc(r.address) === l.sender);
    // "you were its first funder" (first-funder, or the recipient's own "First Funder" relation) is also exactly what a
    // mistaken send of ETH to a fresh address looks like: the transfer being asked about IS the first funding. It only
    // shows you control the address if the address was operated afterwards (it has sent something); otherwise it is a
    // warning, and the stranger rules decide (audit 2026-09-23)
    const fundingOnly = !viaSender && (!viaRecipient || /^First Funder$/i.test(viaRecipient.relation));
    const operated = !!act && act.out > 0;
    if ((fundedBySender || viaRecipient) && fundingOnly && !operated) warnings.push("your address made this address's first-ever deposit — most likely the transfer you are asking about; with nothing ever sent from it, that does not show you control it");
    else if (viaSender || fundedBySender || viaRecipient) {
      if (viaSender) ev.push({ code: "RELATED_TO_SENDER", field: "profiler/address/related-wallets (your address) → address, relation", value: `${viaSender.relation} — ${short(l.address)}`, meaning: "Nansen links the recipient to your wallet." });
      if (fundedBySender) ev.push({ code: "FUNDED_BY_SENDER", field: "profiler/address/first-funder → first_funder_address", value: `${short(ff!.first_funder_address)} on ${ff!.block_timestamp.slice(0, 10)}`, meaning: "Your wallet was the first to ever fund this address — you most likely created it." });
      if (viaRecipient) ev.push({ code: "RELATED_TO_SENDER", field: "profiler/address/related-wallets → address, relation", value: `${viaRecipient.relation} — ${short(viaRecipient.address)}`, meaning: "The recipient's related-wallet list contains your address." });
      return { route: "your-own-wallet", sub: viaSender || viaRecipient ? "related" : "funded", confidence: "high", headline: "This wallet is linked to yours. You probably still control it — nothing is lost.", evidence: ev, rule: 6, warnings };
    }
  }
  // retry: nothing to decide from
  const core = [l.transactions, l.counterparties, l.related];
  if (core.every((r) => !r.ok)) {
    // reached only inside the `core.every((r) => !r.ok)` guard above, so every r here is already the failed variant —
    // cast instead of a `r.ok ? "ok" : r.error` ternary, so there is no "ok" arm left as a dead branch.
    ev.push({ code: "LOOKUPS_FAILED", field: "profiler/address/transactions, counterparties, related-wallets", value: core.map((r) => (r as { ok: false; error: string }).error).join(" / "), meaning: "Nansen did not answer; no verdict is possible from zero data." });
    return { route: "retry", sub: "failed", confidence: "low", headline: "Nansen did not answer for this address. Retry in a minute — no verdict was made.", evidence: ev, rule: 0, warnings };
  }
  // retry: the stranger states (fresh / dormant / active / poisoner) are all read off the transactions page — without it
  // "no rows" would be indistinguishable from "timed out", and "nothing on record" would be a fabricated verdict
  if (!l.transactions.ok) {
    ev.push({ code: "TRANSACTIONS_FAILED", field: "profiler/address/transactions", value: `${l.transactions.error}${l.transactions.status ? ` (HTTP ${l.transactions.status})` : ""}`, meaning: "The transactions lookup failed, so activity cannot be judged; no verdict was made." });
    return { route: "retry", sub: "failed", confidence: "low", headline: "Nansen's transactions lookup failed for this address. Retry in a minute — no verdict was made.", evidence: ev, rule: 0, warnings };
  }
  // retry: a quiet address whose all-time page failed — the 14-day page shows nothing sent, but that says nothing about
  // the months before it; "nothing on record" / "never sent" / "poisoner" would be fabricated from a partial page
  if (l.transactionsWindow === "14d-partial" && act && act.out === 0) {
    ev.push({ code: "HISTORY_INCOMPLETE", field: "profiler/address/transactions (all-time window)", value: `failed; the 14-day page has ${act.rows} rows, 0 sent`, meaning: "Only the last 14 days loaded, and they show no outgoing transfer; the full history is needed to judge this wallet. No verdict was made." });
    return { route: "retry", sub: "failed", confidence: "low", headline: "Nansen returned only the last 14 days for this address. Retry in a minute — no verdict was made.", evidence: ev, rule: 0, warnings };
  }
  // 7–9. stranger — first, two address-poisoning signatures read straight off the transactions page
  // l.transactions.ok is guaranteed true by this point (the two retry checks above already returned if not), so
  // TS narrows it directly — no "else []" fallback branch is needed, or left dead, to reach .data.data.
  const rows: TxRow[] = l.transactions.data.data;
  const inboundTransfers = rows.flatMap((r) => (r.tokens_received ?? []).filter((t) => lc(t.to_address) === l.address));
  const spoof = inboundTransfers.filter((t) => isSpoofSymbol(t.token_symbol));
  if (act && act.rows > 0 && spoof.length >= 2 && spoof.length >= inboundTransfers.length * 0.5 && act.out === 0) {
    ev.push({ code: "SPOOF_TOKEN_TRANSFERS", field: "profiler/address/transactions → tokens_received[].token_symbol", value: `${spoof.length} of ${inboundTransfers.length} inbound transfers are look-alike tokens: ${[...new Set(spoof.map((t) => JSON.stringify(t.token_symbol)))].slice(0, 3).join(", ")}`, meaning: "Fake tokens with homoglyph symbols are how address-poisoning scams plant this address in a victim's history." });
    ev.push({ code: "ACTIVITY", field: "profiler/address/transactions → data[]", value: `${act.in} in / ${act.out} out, last ${act.newest?.slice(0, 10)}`, meaning: "It has never sent anything real — it exists to be copied by mistake." });
    return { route: "active-stranger", sub: "poisoner", confidence: "high", headline: "This is an address-poisoning scam address: it mimics an address you use and only ever 'receives' fake tokens. Anything real you sent is with a scammer.", evidence: ev, rule: 9, warnings };
  }
  const cps = l.counterparties.ok ? l.counterparties.data.data.map((r) => r.counterparty_address) : [];
  const lookalikes = cps.filter((a, i) => cps.some((b, j) => j !== i && lookAlike(a, b)));
  if (lookalikes.length >= 2) warnings.push(`${lookalikes.length} of its counterparties are look-alikes of each other (same first and last characters) — this wallet's history has been poisoned; check every character of the address you meant`);
  const inboundFromExchange = transfers(l).find(({ t }) => lc(t.to_address) === l.address && parseLabel(t.from_address_label)?.exchange);
  if (!act || act.rows === 0) {
    ev.push({ code: "NO_HISTORY", field: "profiler/address/transactions → data", value: "0 rows", meaning: "Nansen has no activity on record for this address on this chain." });
    // "0 rows" is Nansen's answer, not proof the address is new: a handful of well-known wallets return empty profiler
    // pages (vitalik.eth did, 2026-09-16) — the headline says so instead of promising that a re-run will help
    return { route: "active-stranger", sub: "fresh", confidence: "low", headline: `Nansen has nothing on record for this address on ${l.chain}. If you just sent, wait a few minutes and run again; if it is an old, busy address, Nansen simply does not index it — treat it as an unknown wallet.`, evidence: ev, rule: 7, warnings };
  }
  ev.push({ code: "ACTIVITY", field: "profiler/address/transactions → data[]", value: `${act.in} in / ${act.out} out${act.truncated ? " (newest 100)" : ""}, last ${act.newest?.slice(0, 10)}`, meaning: act.out ? "A wallet that receives and sends — someone operates it." : "Only ever received; never sent anything." });
  // inboundFromExchange is only ever set when parseLabel(t.from_address_label)?.exchange is true, and parseLabel returns
  // undefined for a falsy raw — so from_address_label is already a truthy string here; asserted, not defaulted, so
  // there is no "" fallback branch left dead.
  if (inboundFromExchange) ev.push({ code: "FUNDED_BY_EXCHANGE", field: "transaction-with-token-transfer-lookup → token_transfer_array[].from_address_label", value: inboundFromExchange.t.from_address_label!, meaning: "It has received withdrawals from an exchange — a person's wallet, not an exchange's." });
  const top = l.counterparties.ok ? l.counterparties.data.data.slice(0, 3) : [];
  if (top.length) ev.push({ code: "COUNTERPARTIES", field: "profiler/address/counterparties → counterparty_address_label", value: top.map((r) => `${short(r.counterparty_address)} ${(r.counterparty_address_label ?? []).join("/") || "unlabelled"} ×${r.interaction_count}`).join(" · "), meaning: "Its main counterparties carry no exchange or contract identity." });
  if (act.out === 0) {
    return { route: "active-stranger", sub: "dormant", confidence: "low", headline: "An unlabelled wallet that has never sent anything. Odds of a return are low; a memo costs nothing.", evidence: ev, rule: 8, warnings };
  }
  if (depositsInto.length) ev.push({ code: "DEPOSITS_INTO_EXCHANGE", field: "transaction-with-token-transfer-lookup → token_transfer_array[].to_address_label", value: dests.filter((d) => isDepositLabel(d.label)).map((d) => d.label!.raw).join(" · "), meaning: `Its owner deposits into ${[...new Set(depositsInto)].join(", ")} — a person with an exchange account.` });
  const recent = act.daysSinceLastOut !== undefined && act.daysSinceLastOut <= 90;
  return { route: "active-stranger", sub: "active", confidence: recent ? "medium" : "low", headline: `An active, unlabelled wallet (last sent ${act.daysSinceLastOut ?? "?"} days ago). Not an exchange, not a contract — a person. Odds are low but the owner can read a memo.`, evidence: ev, rule: 9, warnings };
}
