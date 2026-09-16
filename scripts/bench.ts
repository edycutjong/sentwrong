/**
 * Reproducible latency + credit proof over the fixture set (DEMO.md). Cold = a fresh in-memory cache per verdict, every
 * call live; warm = the same verdict again from cache. 3 runs, p50/p95 of wall time per verdict, credits per verdict.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run bench            # ~3 × 110 credits
 *   npm run bench -- --runs 1
 */
import { CachedNansenClient, MemoryCache, sentWrong } from "../packages/core/src/index.js";
import { FIXTURE_SET } from "./seed.js";

const runsIdx = process.argv.indexOf("--runs");
const RUNS = runsIdx >= 0 ? Number(process.argv[runsIdx + 1]) : 3;
const apiKey = process.env.NANSEN_API_KEY ?? "";
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };

const cold: number[] = [], warm: number[] = [], credits: number[] = [], calls: number[] = [];
let liveCalls = 0, failed = 0;
const routes: Record<string, number> = {};
for (let run = 1; run <= RUNS; run++) {
  for (const f of FIXTURE_SET) {
    const store = new MemoryCache();
    const client = new CachedNansenClient(apiKey, { store });
    const v1 = await sentWrong(client, f.address, { sender: f.sender, chain: f.chain });
    const v2 = await sentWrong(client, f.address, { sender: f.sender, chain: f.chain });
    cold.push(v1.ms); warm.push(v2.ms); credits.push(v1.credits); calls.push(v1.calls);
    liveCalls += v1.provenance.filter((c) => !c.cached).length; failed += v1.provenance.filter((c) => !c.ok && c.status !== 422).length;
    routes[v1.decision.route] = (routes[v1.decision.route] ?? 0) + 1;
    if (v1.hash !== v2.hash) { console.error(`hash drift on ${f.address}: ${v1.hash} vs ${v2.hash}`); process.exit(1); }
    console.log(`run ${run} ${v1.address.slice(0, 10)}…${f.sender ? " --from" : ""}  ${v1.decision.route.padEnd(17)} cold ${String(v1.ms).padStart(6)} ms  warm ${String(v2.ms).padStart(4)} ms  ${v1.credits} cr / ${v1.calls} calls${v1.provenance.some((c) => !c.ok && c.status !== 422) ? "  ⚠ a lookup failed" : ""}`);
  }
}
const n = cold.length;
console.log(`
verdicts: ${n} (${FIXTURE_SET.length} addresses × ${RUNS} runs) · routes: ${Object.entries(routes).map(([k, v]) => `${k} ${v}`).join(", ")}
cold  p50 ${pct(cold, 0.5)} ms · p95 ${pct(cold, 0.95)} ms · max ${Math.max(...cold)} ms
warm  p50 ${pct(warm, 0.5)} ms · p95 ${pct(warm, 0.95)} ms · max ${Math.max(...warm)} ms
credits/verdict  mean ${(credits.reduce((a, b) => a + b, 0) / n).toFixed(1)} · min ${Math.min(...credits)} · max ${Math.max(...credits)} · total ${credits.reduce((a, b) => a + b, 0)}
calls/verdict    mean ${(calls.reduce((a, b) => a + b, 0) / n).toFixed(1)} · live calls made ${liveCalls} · non-422 failures ${failed}
warm verdicts: 0 credits, 0 network calls, identical decision hash (checked every run)`);
