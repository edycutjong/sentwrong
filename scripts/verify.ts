/**
 * Replay every fixture OFFLINE and prove the engine is deterministic: same responses + same clock → same route, same
 * evidence, same decision hash, zero network calls, zero credits. Exit 1 on any mismatch. No API key needed.
 *
 *   npm run verify
 *   npm run verify -- --update     # after an INTENTIONAL engine change: rewrite each fixture's verdict from its recorded
 *                                  # responses (the responses themselves are never touched) and say which ones changed
 */
import { writeFileSync } from "node:fs";
import { CachedNansenClient, sentWrong, listFixtures, readFixture, fixtureStore, type Verdict } from "../packages/core/src/index.js";

process.env.NANSEN_OFFLINE = "1";
const UPDATE = process.argv.includes("--update");
const files = listFixtures();
if (files.length === 0) { console.error("no fixtures/ — run `npm run seed` first"); process.exit(1); }

/** The parts of a verdict a replay must reproduce exactly. Cost, timing and cache metadata are excluded by design. */
function projection(v: Verdict) {
  return { hash: v.hash, route: v.decision.route, sub: v.decision.sub, confidence: v.decision.confidence, entity: v.decision.entity ?? null, evidence: v.decision.evidence.map((e) => [e.code, e.value]), action: v.action.text, transfer: v.transfer ?? null };
}

let ok = 0;
const failures: string[] = [];
for (const path of files) {
  const f = readFixture(path);
  const client = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
  const problems: string[] = [];
  let replay: Verdict | undefined;
  try { replay = await sentWrong(client, f.address, { ...f.options, now: f.now }); }
  catch (e) { problems.push(`threw: ${(e as Error).message.slice(0, 120)}`); }
  if (replay && UPDATE) {
    const changed = replay.hash !== f.verdict.hash;
    writeFileSync(path, JSON.stringify({ ...f, verdict: replay }, null, 2) + "\n");
    console.log(`${changed ? "↻" : "="} ${f.address.slice(0, 10)}…${f.options.sender ? " --from" : ""}  ${changed ? `${f.verdict.hash.slice(0, 12)} → ${replay.hash.slice(0, 12)}` : replay.hash.slice(0, 12)}  ${replay.decision.route}/${replay.decision.sub}`);
    ok++; continue;
  }
  if (replay) {
    const want = JSON.stringify(projection(f.verdict)), got = JSON.stringify(projection(replay));
    if (replay.hash !== f.verdict.hash) problems.push(`hash ${replay.hash.slice(0, 12)} ≠ recorded ${f.verdict.hash.slice(0, 12)}`);
    if (want !== got) problems.push("route/evidence/action differ from the recorded verdict");
    const network = replay.provenance.filter((c) => !c.cached);
    if (network.length) problems.push(`${network.length} call(s) left the cache: ${network.map((c) => `${c.endpoint}${c.ok ? "" : " (failed)"}`).join(", ")}`);
    if (replay.credits !== 0) problems.push(`${replay.credits} credits spent on a replay`);
    const recordedHashes = new Set(f.verdict.provenance.filter((c) => c.ok).map((c) => c.responseHash));
    for (const c of replay.provenance) if (c.ok && !recordedHashes.has(c.responseHash)) problems.push(`${c.endpoint} served a response the live run never saw`);
  }
  const label = `${f.address.slice(0, 10)}…${f.options.sender ? " --from" : ""}`.padEnd(20);
  if (problems.length === 0) {
    ok++;
    console.log(`✔ ${label} ${replay!.hash.slice(0, 12)}  ${replay!.provenance.length} calls replayed · ${replay!.decision.route}/${replay!.decision.sub} · recorded ${f.recordedAt.slice(0, 16)}Z · ${f.edge}`);
  } else { failures.push(path); console.log(`✖ ${label} ${problems.join("; ")}`); }
}
console.log(UPDATE ? `\n${ok}/${files.length} fixture verdicts rewritten from their recorded responses` : `\n${ok}/${files.length} verdicts reproduced offline`);
if (failures.length) process.exit(1);
