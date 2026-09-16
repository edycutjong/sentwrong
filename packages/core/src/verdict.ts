/**
 * sentWrong(): gather → classify → text, plus the provenance, credits and the decision hash. This is what the CLI, the
 * web route, seed.ts and verify.ts all call.
 */
import { createHash } from "node:crypto";
import type { NansenClient, Call } from "./client.js";
import { gather, splitDirection, type GatherOptions, type Lookups } from "./lookups.js";
import { classify, type Decision } from "./classify.js";
import { actionFor, type Action, type Transfer } from "./text.js";
import { parseLabel } from "./labels.js";
import type { Chain } from "./nansen.js";

/** One line in the "what Nansen sees" table: a counterparty with the best label we resolved for it. */
export type Row = { address: string; label: string; entityLabel?: string; interactions: number; inUsd: number; outUsd: number };

export type Verdict = {
  address: string;
  sender?: string;
  chain: Chain;
  decision: Decision;
  action: Action;
  rows: Row[];
  /** the mistaken transfer, when the sender was given and Nansen shows it */
  transfer?: Transfer;
  deep?: { labels: string[]; credits: number; agrees: boolean; note: string };
  provenance: Call[];
  credits: number;
  calls: number;
  cachedCalls: number;
  skipped: string[];
  ms: number;
  asOf: string;
  /** sha256 of the decision only (route, state, confidence, entity, evidence codes+values, action text). Never cost or timing. */
  hash: string;
};

export type VerdictOptions = GatherOptions & { now?: number };

export function decisionHash(d: Decision, action: Action): string {
  const projection = { route: d.route, sub: d.sub, confidence: d.confidence, entity: d.entity ?? null, evidence: d.evidence.map((e) => [e.code, e.value]), action: action.text };
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

/** Labels seen for any address in the transaction lookups (entity labels beat the profiler's wealth tags). */
function labelIndex(l: Lookups): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of l.txLookups) if (x.result.ok) for (const row of x.result.data.data) for (const t of row.token_transfer_array ?? []) {
    const f = parseLabel(t.from_address_label), to = parseLabel(t.to_address_label);
    if (f && !f.generic) m.set(t.from_address.toLowerCase(), t.from_address_label!);
    if (to && !to.generic) m.set(t.to_address.toLowerCase(), t.to_address_label!);
  }
  return m;
}

export function rowsFor(l: Lookups): Row[] {
  if (!l.counterparties.ok) return [];
  const idx = labelIndex(l);
  return l.counterparties.data.data.slice(0, 8).map((r) => ({
    address: r.counterparty_address.toLowerCase(),
    label: (r.counterparty_address_label ?? []).join(" / ") || "—",
    entityLabel: idx.get(r.counterparty_address.toLowerCase()),
    interactions: r.interaction_count,
    inUsd: r.volume_in_usd ?? 0,
    outUsd: r.volume_out_usd ?? 0,
  }));
}

/** The transfer from the sender to the recipient, if the transactions page shows it. */
export function findTransfer(l: Lookups): Transfer | undefined {
  if (!l.sender || !l.transactions.ok) return undefined;
  const { inbound } = splitDirection(l.transactions.data.data, l.address);
  for (const r of inbound) for (const t of r.tokens_received ?? []) {
    if (t.from_address.toLowerCase() === l.sender && t.to_address.toLowerCase() === l.address) return { hash: r.transaction_hash, date: r.block_timestamp, amount: t.token_amount, symbol: t.token_symbol, from: l.sender, to: l.address };
  }
  return undefined;
}

export async function sentWrong(client: NansenClient, address: string, opts: VerdictOptions = {}): Promise<Verdict> {
  const t0 = Date.now();
  const before = client.calls.length;
  const l = await gather(client, address, opts);
  const decision = classify(l, opts.now ?? Date.now());
  const transfer = findTransfer(l);
  const action = actionFor(decision, { address: l.address, sender: l.sender, chain: l.chain, transfer });
  let deep: Verdict["deep"];
  if (l.deep) {
    if (l.deep.ok) {
      const labels = l.deep.data.data.map((x) => x.label);
      const entityLabels = l.deep.data.data.filter((x) => (x.kind ?? []).includes("entity")).map((x) => x.label);
      const agrees = decision.entity ? entityLabels.some((x) => x.toLowerCase().includes(decision.entity!.toLowerCase())) : decision.route === "active-stranger" ? entityLabels.length === 0 : true;
      deep = { labels, credits: 100, agrees, note: agrees ? "profiler/address/labels agrees with the verdict" : `profiler/address/labels disagrees: ${entityLabels.join(", ") || "no entity label"} — read both before acting` };
      if (!agrees) decision.warnings.push(deep.note);
    } else deep = { labels: [], credits: 0, agrees: true, note: `deep check failed: ${l.deep.error}` };
  }
  const provenance = client.calls.slice(before);
  return {
    address: l.address, sender: l.sender, chain: l.chain, decision, action, rows: rowsFor(l), transfer, deep,
    provenance, credits: provenance.reduce((n, c) => n + c.credits, 0), calls: provenance.length, cachedCalls: provenance.filter((c) => c.cached).length,
    skipped: l.skipped, ms: Date.now() - t0, asOf: new Date(opts.now ?? Date.now()).toISOString(), hash: decisionHash(decision, action),
  };
}
