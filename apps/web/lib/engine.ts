/**
 * Server-side engine for the web app. The Nansen key never leaves this process: the browser talks to /api/verdict.
 * One in-memory cache per server instance (Vercel functions have no durable disk) with the same 24 h TTL as the CLI.
 */
import { CachedNansenClient, MemoryCache, DiskCache, sentWrong, CHAINS, EVM_ADDRESS, type Chain, type Verdict, type CallEvent } from "@sentwrong/core";
import { join } from "node:path";

// On Vercel the function has no durable disk, so the cache lives in memory and only for the life of one warm instance
// (a cold start begins empty — every call is live again). Locally (`npm run dev`) the same on-disk cache the CLI uses
// survives restarts, so a rehearsed address stays warm for a recording.
const store = process.env.VERCEL ? new MemoryCache() : new DiskCache(join(process.cwd(), ".cache"));
export const TTL_MS = 24 * 3600 * 1000;

export function client(onEvent?: (e: CallEvent) => void): CachedNansenClient {
  const key = process.env.NANSEN_API_KEY ?? "";
  if (!key) throw new Error("NANSEN_API_KEY is not set on the server");
  return new CachedNansenClient(key, { store, ttlMs: TTL_MS, onEvent });
}

export type VerdictInput = { address: string; sender?: string; chain?: string; deep?: boolean };

export function parseInput(raw: unknown): VerdictInput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const address = String(o.address ?? "").trim();
  const sender = o.sender ? String(o.sender).trim() : undefined;
  const chain = o.chain ? String(o.chain) : "ethereum";
  if (!EVM_ADDRESS.test(address)) throw new Error("Recipient must be an EVM address: 0x followed by 40 hex characters. Solana, Tron and Bitcoin addresses are not supported.");
  if (sender && !EVM_ADDRESS.test(sender)) throw new Error("Your address must be an EVM address (0x + 40 hex characters).");
  if (!CHAINS.includes(chain as Chain)) throw new Error(`Unsupported chain "${chain}". One of: ${CHAINS.join(", ")}.`);
  return { address, sender, chain, deep: o.deep === true };
}

/**
 * One verdict. `onEvent` receives every Nansen call twice — `start` before it is made, `end` with the finished Call —
 * so the route can stream a pending row and then the real one; the Calls are the objects `verdict.provenance` holds.
 */
export function verdictFor(input: VerdictInput, onEvent?: (e: CallEvent) => void): Promise<Verdict> {
  const c = client(onEvent);
  return sentWrong(c, input.address, { sender: input.sender, chain: input.chain as Chain, deep: input.deep });
}
