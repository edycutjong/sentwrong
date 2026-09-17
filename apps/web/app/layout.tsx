import type { Metadata, Viewport } from "next";
import "./globals.css";

const HERO = "0xe460774c849089ee3edf0fb06da14c066caabbef";
const HERO_HEADLINE = "This is a Binance deposit address. Recoverable through Binance support.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://sentwrong.edycu.dev"),
  title: "Sent Wrong — where your transfer went, by Nansen labels",
  description: "Sent crypto to the wrong address? Paste it. Nansen labels decide: exchange deposit, your own wallet, a stranger or a contract. Then the ticket is drafted.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Sent Wrong",
    title: "Sent Wrong",
    description: "Paste the address you sent to. One of four recovery routes turns green — and the ticket is drafted.",
    images: [{ url: `/api/og?route=exchange-deposit&address=${HERO}&headline=${encodeURIComponent(HERO_HEADLINE)}&conf=high&entity=Binance&v=2`, width: 1200, height: 630, alt: "Sent Wrong share card: exchange deposit, high confidence — this is a Binance deposit address, recoverable through Binance support" }],
  },
  twitter: { card: "summary_large_image", creator: "@edycutjong", title: "Sent Wrong", description: "Paste the address you sent to. One of four recovery routes turns green — and the ticket is drafted." },
  authors: [{ name: "Edy Cu Tjong", url: "https://github.com/edycutjong" }],
  creator: "Edy Cu Tjong",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
