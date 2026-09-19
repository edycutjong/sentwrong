import { NextRequest } from "next/server";
import { parseInput, verdictFor } from "@/lib/engine";
import { clientIp, ipAllowed, budgetExhausted, recordSpend, RATE_MESSAGE, BUDGET_MESSAGE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { address, sender?, chain?, deep? } → NDJSON stream:
 *   {"type":"start", "start": {seq, endpoint, body}}   a Nansen call is about to be made (the rail's pending row)
 *   {"type":"call", "seq", "call": Call}               the same call, finished — live provenance, one line per call
 *   {"type":"verdict", "verdict": V}                   the verdict, last
 *   {"type":"error", "message": …}                     instead of a verdict
 * The API key lives only in this process. Spend guard (lib/guard.ts): 429 past the per-IP rate, 503 past the daily
 * credit ceiling — both before any Nansen call.
 */
export async function POST(req: NextRequest) {
  let input;
  try { input = parseInput(await req.json()); }
  catch (e) { return Response.json({ type: "error", message: (e as Error).message }, { status: 400 }); }
  const gate = ipAllowed(clientIp(req.headers));
  if (!gate.ok) return Response.json({ type: "error", message: RATE_MESSAGE(gate.retryAfter) }, { status: 429, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } });
  if (budgetExhausted()) return Response.json({ type: "error", message: BUDGET_MESSAGE }, { status: 503, headers: { "retry-after": "3600", "cache-control": "no-store" } });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const v = await verdictFor(input, (e) => (e.type === "start" ? send({ type: "start", start: e.start }) : send({ type: "call", seq: e.seq, call: e.call })));
        recordSpend(v.credits);
        send({ type: "verdict", verdict: v });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
