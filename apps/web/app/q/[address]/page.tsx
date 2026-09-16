import type { Metadata } from "next";
import { cache } from "react";
import { parseInput, verdictFor } from "@/lib/engine";
import { VerdictCard } from "../../VerdictCard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// generateMetadata and the page both need the verdict; React's per-request cache makes it one set of Nansen calls, not two
const loadVerdict = cache(async (address: string, sender: string | undefined, chain: string | undefined) => {
  const input = parseInput({ address, sender, chain });
  return { input, verdict: await verdictFor(input) };
});

async function load(props: Props) {
  const { address } = await props.params;
  const sp = await props.searchParams;
  return loadVerdict(address, typeof sp.from === "string" ? sp.from : undefined, typeof sp.chain === "string" ? sp.chain : undefined);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  try {
    const { verdict: v } = await load(props);
    const title = `${v.decision.route.replace(/-/g, " ")} — ${v.address.slice(0, 8)}…`;
    const og = `/api/og?route=${v.decision.route}&address=${v.address}&headline=${encodeURIComponent(v.decision.headline)}&conf=${v.decision.confidence}${v.decision.entity ? `&entity=${encodeURIComponent(v.decision.entity)}` : ""}`;
    return { title: `Sent Wrong — ${title}`, description: v.decision.headline, openGraph: { title, description: v.decision.headline, images: [{ url: og, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, description: v.decision.headline, images: [og] } };
  } catch { return { title: "Sent Wrong" }; }
}

export default async function Share(props: Props) {
  let out: Awaited<ReturnType<typeof load>>;
  try { out = await load(props); }
  catch (e) { return <div className="err">{(e as Error).message}</div>; }
  const { input, verdict } = out;
  return (
    <>
      <p className="sub">Verdict for <code>{verdict.address}</code> on {verdict.chain}{verdict.sender ? <> · from <code>{verdict.sender}</code></> : null}. <a href={`/?address=${input.address}${input.sender ? `&from=${input.sender}` : ""}&chain=${input.chain}`}>Run it again live →</a></p>
      <VerdictCard v={verdict} />
    </>
  );
}
