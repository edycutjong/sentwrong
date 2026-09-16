/**
 * Server-side engine for the web app. The Nansen key never leaves this process: the browser talks to /api/verdict.
 * One in-memory cache per server instance (Vercel functions have no durable disk) with the same 24 h TTL as the CLI.
 */
import { CachedNansenClient, MemoryCache, sentWrong, CHAINS, EVM_ADDRESS, type Chain, type Verdict } from "@sentwrong/core";

const store = new MemoryCache();
export const TTL_MS = 24 * 3600 * 1000;

export function client(): CachedNansenClient {
  const key = process.env.NANSEN_API_KEY ?? "";
  if (!key) throw new Error("NANSEN_API_KEY is not set on the server");
  return new CachedNansenClient(key, { store, ttlMs: TTL_MS });
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

export async function verdictFor(input: VerdictInput, onCall?: (c: CachedNansenClient) => void): Promise<Verdict> {
  const c = client();
  const p = sentWrong(c, input.address, { sender: input.sender, chain: input.chain as Chain, deep: input.deep });
  if (onCall) {
    // stream provenance as calls land: poll the client's call log while the verdict is in flight
    let seen = 0;
    const timer = setInterval(() => { if (c.calls.length > seen) { seen = c.calls.length; onCall(c); } }, 120);
    try { return await p; } finally { clearInterval(timer); onCall(c); }
  }
  return p;
}
