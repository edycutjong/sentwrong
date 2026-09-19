import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

export const metadata: Metadata = { title: "Sent Wrong — nothing here", robots: { index: false, follow: true } };

/** The 404 — same shell as the home, the product's voice, and the three places that do exist. */
export default function NotFound() {
  return (
    <>
      <SiteHeader current="home" />
      <main className="wrap judge">
        <p className="judge-kicker">404 · nothing at this address</p>
        <h1 className="claim">Nothing here. Your transfer, though, went somewhere.</h1>
        <p className="judge-lede">
          This page does not exist. Three things do: the checker at <Link href="/">/</Link>, where you paste the address you sent to and one of four recovery routes turns green; a verdict permalink at{" "}
          <code>/q/0x…</code> (the address you sent to, 42 hex characters); and the page for the judge at <Link href="/judge">/judge</Link> — the claim, the click path, the receipts.
        </p>
        <p className="notfound-actions">
          <Link href="/" className="btn primary">
            Check an address
          </Link>
          <Link href="/judge" className="btn">
            For the judge
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
