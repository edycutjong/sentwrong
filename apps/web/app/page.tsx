import type { Fixture } from "@sentwrong/core";
import { Sentwrong } from "@/components/Sentwrong";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { exampleFrom } from "@/lib/example";
import hero from "../../../fixtures/0xe460774c849089ee3edf0fb06da14c066caabbef.json";
import burn from "../../../fixtures/0x000000000000000000000000000000000000dead.json";
import poisoner from "../../../fixtures/0x50b37a3ec6c04609968810801531f5021929eac9.json";
import own from "../../../fixtures/0x3ff462b155011159f9afe68b0a3c509dc6f462b0--from-0xb0aeba10.json";

export const dynamic = "force-dynamic";

/** The empty state's examples: four of the 13 recorded verdicts `npm run verify` replays — the hero first, 0 credits, labelled. */
const EXAMPLES = [
  exampleFrom(hero as unknown as Fixture, "0xe460774c849089ee3edf0fb06da14c066caabbef.json"),
  exampleFrom(burn as unknown as Fixture, "0x000000000000000000000000000000000000dead.json"),
  exampleFrom(poisoner as unknown as Fixture, "0x50b37a3ec6c04609968810801531f5021929eac9.json"),
  exampleFrom(own as unknown as Fixture, "0x3ff462b155011159f9afe68b0a3c509dc6f462b0--from-0xb0aeba10.json"),
];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <>
      <SiteHeader current="home" />
      <Sentwrong initialAddress={pick("address")} initialSender={pick("from")} initialChain={pick("chain")} examples={EXAMPLES} />
      <SiteFooter />
    </>
  );
}
