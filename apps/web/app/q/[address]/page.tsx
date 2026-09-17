import type { Metadata } from "next";
import { cache } from "react";
import { parseInput, verdictFor } from "@/lib/engine";
import { Sentwrong } from "@/components/Sentwrong";
import { SiteHeader, SiteFooter } from "@/components/Shell";

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
    return {
      title: `Sent Wrong — ${title}`,
      description: v.decision.headline,
      openGraph: { title, description: v.decision.headline, images: [{ url: og, width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title, description: v.decision.headline, images: [og] },
    };
  } catch {
    return { title: "Sent Wrong" };
  }
}

/** Permalink: the verdict is computed server-side and rendered in the home shell, so the share card and the page agree. */
export default async function Share(props: Props) {
  const { address } = await props.params;
  const sp = await props.searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const chain = typeof sp.chain === "string" ? sp.chain : undefined;
  let verdict: Awaited<ReturnType<typeof load>>["verdict"] | undefined;
  let error: string | undefined;
  try {
    verdict = (await load(props)).verdict;
  } catch (e) {
    // no key, a malformed address, Nansen down: the honest error in the banner — never a fabricated verdict
    error = (e as Error).message;
  }
  return (
    <>
      <SiteHeader current="home" />
      <Sentwrong initialAddress={address} initialSender={from} initialChain={chain} initialVerdict={verdict} initialError={error} examples={[]} />
      <SiteFooter />
    </>
  );
}
