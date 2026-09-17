import Link from "next/link";
import pkg from "../package.json";

export const VERSION = `v${pkg.version}`;
export const REPO = "https://github.com/edycutjong/sentwrong";
export const SITE = "https://sentwrong-app.vercel.app";

/** The family mark: one green bar over two grey ones — the answer among the rest, in 24px. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="3" width="20" height="5" rx="1.5" fill="var(--real)" />
      <rect x="2" y="10" width="20" height="4" rx="1.5" fill="var(--border-2)" />
      <rect x="2" y="16" width="20" height="4" rx="1.5" fill="var(--border-2)" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "judge" }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Sent Wrong — home">
        <Mark />
        <span className="brand-name">sentwrong</span>
        <span className="brand-tag">where your transfer went · on Nansen</span>
      </Link>
      <nav className="site-nav" aria-label="site">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>
          Check
        </Link>
        <Link href="/judge" aria-current={current === "judge" ? "page" : undefined}>
          For the judge
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-row">
        <span>
          <Mark size={14} /> sentwrong <a href={`${REPO}/releases/latest`}>{VERSION}</a>
        </span>
        <span className="foot-links">
          <a href={`${REPO}/blob/main/docs/SCORING.md`}>how it decides</a>
          <a href={`${REPO}/blob/main/DEMO.md`}>reproduce it</a>
          <Link href="/judge">for the judge</Link>
          <a href="https://docs.nansen.ai" target="_blank" rel="noreferrer">
            Nansen API
          </a>
        </span>
      </div>
      <p className="foot-note">
        Built on the Nansen API for the Meridian Buildathon by{" "}
        <a href="https://x.com/edycutjong" target="_blank" rel="noreferrer">
          @edycutjong
        </a>
        . Every term on the card is a Nansen field; it tells you who can act on your transfer and drafts the message — it never moves funds. Never pay anyone who promises to recover funds. Not
        financial advice.
      </p>
    </footer>
  );
}
