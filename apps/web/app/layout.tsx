import type { Metadata } from "next";
import "./globals.css";

const HERO = "0xe460774c849089ee3edf0fb06da14c066caabbef";
const HERO_HEADLINE = "This is a Binance deposit address. Recoverable through Binance support.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://sentwrong.edycu.dev"),
  title: "Sent Wrong — where your transfer went, decided by Nansen labels",
  description: "Sent crypto to the wrong address? Paste it. Nansen labels decide whether it is an exchange deposit address, your own wallet, a stranger, or a contract — and draft the ticket.",
  openGraph: {
    title: "Sent Wrong",
    description: "Paste the address you sent to. One of four recovery routes turns green — and the ticket is drafted.",
    images: [`/api/og?route=exchange-deposit&address=${HERO}&headline=${encodeURIComponent(HERO_HEADLINE)}&conf=high&entity=Binance`],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
