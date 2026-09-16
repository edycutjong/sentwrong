import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sent Wrong — which recovery route are you on?",
  description: "Sent crypto to the wrong address? Paste it. Nansen labels decide whether it is an exchange deposit address, your own wallet, a stranger, or a contract — and draft the ticket.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="top">
            <h1>Sent Wrong <span>· recovery-route triage on Nansen</span></h1>
            <nav><a href="/">Check</a><a href="https://github.com/edycutjong/sentwrong" target="_blank" rel="noreferrer">GitHub</a></nav>
          </header>
          {children}
          <footer className="foot">
            Every term on this page is a Nansen API field (profiler transactions, counterparties, related-wallets, first-funder, transaction lookup). Nothing here is legal or financial advice; it tells you who can act on your transfer and drafts the message. Never pay anyone who promises to recover funds.
          </footer>
        </div>
      </body>
    </html>
  );
}
