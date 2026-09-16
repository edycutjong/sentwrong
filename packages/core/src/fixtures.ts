import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryCache, type CacheEntry } from "./cache.js";
import type { Verdict, VerdictOptions } from "./verdict.js";

/**
 * A recorded live run: every raw Nansen response the verdict touched (keyed by cache key, byte-for-byte), the verdict,
 * and the clock it ran under. `scripts/seed.ts` writes these; `scripts/verify.ts` and the tests replay them with
 * NANSEN_OFFLINE=1 — same inputs, same clock → the decision hash must come out identical. Responses are never edited.
 */
export type Fixture = {
  edge: string;
  address: string;
  options: Pick<VerdictOptions, "sender" | "chain">;
  now: number;
  recordedAt: string;
  live: { calls: number; credits: number; ms: number };
  responses: Record<string, CacheEntry>;
  verdict: Verdict;
};

export const FIXTURES_DIR = "fixtures";

export function fixtureName(address: string, sender?: string): string {
  return `${address.toLowerCase()}${sender ? `--from-${sender.toLowerCase().slice(0, 10)}` : ""}`;
}
export function writeFixture(f: Fixture, dir = FIXTURES_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fixtureName(f.address, f.options.sender)}.json`);
  writeFileSync(path, JSON.stringify(f, null, 2) + "\n");
  return path;
}
export function readFixture(path: string): Fixture { return JSON.parse(readFileSync(path, "utf8")) as Fixture; }
export function listFixtures(dir = FIXTURES_DIR): string[] {
  try { return readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => join(dir, n)); } catch { return []; }
}
/** A cache store pre-loaded with the fixture's responses — plug into `CachedNansenClient` with `offline: true`. */
export function fixtureStore(f: Fixture): MemoryCache {
  const store = new MemoryCache();
  for (const [key, entry] of Object.entries(f.responses)) store.set(key, entry);
  return store;
}
