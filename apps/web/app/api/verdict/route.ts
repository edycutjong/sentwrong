import { NextRequest } from "next/server";
import { parseInput, verdictFor } from "@/lib/engine";
import type { Call } from "@sentwrong/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { address, sender?, chain?, deep? } → NDJSON stream:
 *   {"type":"call", "call": Call}      one line per Nansen call as it completes (live provenance)
 *   {"type":"verdict", "verdict": V}   the verdict, last
 *   {"type":"error", "message": …}     instead of a verdict
 * The API key lives only in this process.
 */
export async function POST(req: NextRequest) {
  let input;
  try { input = parseInput(await req.json()); }
  catch (e) { return Response.json({ type: "error", message: (e as Error).message }, { status: 400 }); }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      let sent = 0;
      try {
        const v = await verdictFor(input, (c) => { for (const call of c.calls.slice(sent) as Call[]) send({ type: "call", call }); sent = c.calls.length; });
        send({ type: "verdict", verdict: v });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
