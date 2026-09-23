#!/usr/bin/env -S npx tsx
import { cachedClientFromEnv, sentWrong, CHAINS, CREDITS, type Verdict, type Chain } from "@sentwrong/core";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sender = opt("--from");
const chain = (opt("--chain") ?? "ethereum") as Chain;
const address = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--from" && args[i - 1] !== "--chain");

if (!address || flags.has("--help")) {
  console.log(`usage: sentwrong <recipient address> [--from <your address>] [--chain ${CHAINS.join("|")}] [--json] [--explain] [--deep] [--no-cache]
  Sent crypto to the wrong address? Nansen decides which of four recovery routes you are on and drafts the ticket.
  --deep  adds one profiler/address/labels call (${CREDITS["profiler/address/labels"]} credits) and shows whether it agrees.
  Needs NANSEN_API_KEY (set -a; source ~/.config/nansen/meridian.env; set +a).`);
  process.exit(address ? 0 : 1);
}
if (!CHAINS.includes(chain)) { console.error(`unsupported chain "${chain}" — one of ${CHAINS.join(", ")}`); process.exit(1); }
if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { console.error(`"${address}" is not an EVM address (0x + 40 hex characters). Solana/Tron/Bitcoin addresses are not supported.`); process.exit(1); }
if (sender && !/^0x[0-9a-fA-F]{40}$/.test(sender)) { console.error(`--from "${sender}" is not an EVM address`); process.exit(1); }

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", B = "\x1b[1m", X = "\x1b[0m";
if (flags.has("--deep")) console.error(`${Y}--deep: this run will spend ${CREDITS["profiler/address/labels"]} credits on profiler/address/labels${X}`);
let client: ReturnType<typeof cachedClientFromEnv>;
try { client = cachedClientFromEnv({ ttlMs: flags.has("--no-cache") ? 0 : undefined }); }
catch (e) {
  // the first thing a new clone hits if the export was skipped: one actionable line, not a stack trace
  console.error(`${R}${(e as Error).message}${X}\n  export NANSEN_API_KEY=nsn_…   (https://app.nansen.ai/api — free tier works)\n  no key? \`npm run verify\` replays the 13 recorded verdicts offline`);
  process.exit(1);
}
let v: Verdict;
try { v = await sentWrong(client, address, { sender, chain, deep: flags.has("--deep") }); }
catch (e) { console.error(`${R}${(e as Error).message}${X}`); process.exit(2); }

if (flags.has("--json")) { console.log(JSON.stringify(v, null, 2)); process.exit(0); }

const colour = { "exchange-deposit": G, "your-own-wallet": G, "active-stranger": Y, "contract-or-burn": R, retry: D }[v.decision.route];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
console.log(`\n${B}${v.address}${X} on ${v.chain}${v.sender ? ` · from ${short(v.sender)}` : ""}`);
if (v.rows.length) {
  console.log(`${D}counterparties (profiler/address/counterparties, labels via transaction lookups):${X}`);
  for (const r of v.rows.slice(0, 6)) console.log(`  ${short(r.address)}  ${(r.entityLabel ?? r.label).padEnd(34).slice(0, 34)} ×${String(r.interactions).padStart(4)}  in $${Math.round(r.inUsd).toLocaleString("en-US").padStart(11)}  out $${Math.round(r.outUsd).toLocaleString("en-US").padStart(11)}`);
}
console.log(`\n${colour}${B}${v.decision.route.toUpperCase()}${X} ${colour}(${v.decision.confidence}${v.decision.sub !== v.decision.route ? ` · ${v.decision.sub}` : ""})${X}\n${B}${v.decision.headline}${X}`);
for (const e of v.decision.evidence) console.log(`  ${G}✔${X} ${e.meaning}\n    ${D}${e.field} = ${e.value}${X}`);
for (const w of v.decision.warnings) console.log(`  ${Y}⚠ ${w}${X}`);
if (v.transfer) console.log(`  ${D}your transfer: ${v.transfer.amount} ${v.transfer.symbol} on ${v.transfer.date.slice(0, 10)} · ${v.transfer.hash}${X}`);
if (v.deep) console.log(`  ${v.deep.agrees ? G : R}deep check (100 credits): ${v.deep.labels.join(", ") || "no labels"} — ${v.deep.note}${X}`);
console.log(`\n${B}${v.action.title}${X}\n${"─".repeat(60)}\n${v.action.text}\n${"─".repeat(60)}`);
if (flags.has("--explain")) {
  console.log(`${D}rule ${v.decision.rule} fired · decision hash ${v.hash}${X}`);
  for (const c of v.provenance) console.log(`${D}  ${c.ok ? (c.cached ? "cache" : " live") : " FAIL"} ${c.endpoint.padEnd(40)} ${String(c.credits).padStart(3)} cr ${String(c.ms).padStart(5)} ms${c.attempts > 1 ? ` ×${c.attempts}` : ""}${c.error ? ` — ${c.error}` : ""}  fields: ${c.fieldsUsed.join(", ")}${X}`);
  if (v.skipped.length) console.log(`${D}  skipped: ${v.skipped.join(", ")}${X}`);
}
const failed = v.provenance.filter((c) => !c.ok).length;
console.log(`${D}${v.credits} credits · ${v.calls} calls (${v.cachedCalls} cached${failed ? `, ${failed} failed` : ""}) · ${(v.ms / 1000).toFixed(1)}s · verdict ${v.hash.slice(0, 12)}${X}`);
