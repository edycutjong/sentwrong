/**
 * The empty state's examples come from the recorded fixtures (`fixtures/*.json`, live 2026-09-16, byte-for-byte) — the
 * same files `npm run verify` replays. Only the decision is sent to the client; the raw responses and the ticket text
 * stay on the server (a fixture is 25–75 KB, the trimmed example under 2 KB).
 */
import type { Decision, Fixture } from "@sentwrong/core";

export type ExampleVerdict = {
  address: string;
  sender?: string;
  chain: string;
  decision: Pick<Decision, "route" | "sub" | "confidence" | "entity" | "headline" | "evidence" | "warnings">;
  hash: string;
  live: { calls: number; credits: number };
  recordedAt: string;
  file: string;
};

export function exampleFrom(f: Fixture, file: string): ExampleVerdict {
  const d = f.verdict.decision;
  return {
    address: f.verdict.address,
    sender: f.verdict.sender,
    chain: f.verdict.chain,
    decision: { route: d.route, sub: d.sub, confidence: d.confidence, entity: d.entity, headline: d.headline, evidence: d.evidence, warnings: d.warnings },
    hash: f.verdict.hash,
    live: { calls: f.live.calls, credits: f.live.credits },
    recordedAt: f.recordedAt.slice(0, 10),
    file,
  };
}
