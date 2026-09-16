/**
 * Record the fixture set: run each address LIVE once, write every raw Nansen response the verdict touched plus the
 * verdict itself to fixtures/<address>.json. Responses are stored byte-for-byte and never edited. `npm run verify`
 * replays them offline and must reproduce every decision hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed          # all (~150 credits)
 *   npm run seed -- 0xe460 0x0000                                                # a subset by prefix
 */
import { CachedNansenClient, MemoryCache, sentWrong, writeFixture, type Fixture } from "../packages/core/src/index.js";
import { FIXTURE_SET } from "./fixture-set.js";


const wanted = process.argv.slice(2).map((q) => q.toLowerCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.some((w) => f.address.toLowerCase().startsWith(w))) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0, totalCalls = 0;

for (const f of set) {
  // A fresh in-memory store per fixture: every response is fetched live and lands in the file; nothing is shared or reused.
  const store = new MemoryCache();
  const client = new CachedNansenClient(apiKey, { store });
  const now = Date.now();
  const verdict = await sentWrong(client, f.address, { sender: f.sender, chain: f.chain, now });
  const live = verdict.provenance.filter((c) => !c.cached && c.ok);
  const failed = verdict.provenance.filter((c) => !c.ok);
  const fixture: Fixture = {
    edge: f.edge, address: verdict.address, options: { sender: f.sender, chain: f.chain }, now, recordedAt: new Date(now).toISOString(),
    live: { calls: live.length, credits: verdict.credits, ms: verdict.ms }, responses: store.entries(), verdict,
  };
  const path = writeFixture(fixture);
  totalCredits += verdict.credits; totalCalls += live.length;
  console.log(`${verdict.address.slice(0, 10)}…${f.sender ? " --from" : ""} → ${path}  ${verdict.decision.route}/${verdict.decision.sub} (${verdict.decision.confidence}) · ${verdict.credits} cr / ${live.length} calls / ${(verdict.ms / 1000).toFixed(1)}s · ${verdict.hash.slice(0, 12)}${failed.length ? `  ⚠ ${failed.length} failed: ${failed.map((c) => `${c.endpoint} (${c.error?.slice(0, 40)})`).join(", ")}` : ""}`);
}
console.log(`\n${set.length} fixtures · ${totalCredits} credits · ${totalCalls} live calls`);
