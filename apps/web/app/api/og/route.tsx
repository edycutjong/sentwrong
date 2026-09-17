import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";
const COLOURS: Record<string, string> = { "exchange-deposit": "#2ecc71", "your-own-wallet": "#4ea1ff", "active-stranger": "#f5b53f", "contract-or-burn": "#ff5d5d", retry: "#7f8c9b" };

/** Share card. Text comes from the /q page's own verdict; the route decides the colour. */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const route = q.get("route") ?? "retry";
  const address = (q.get("address") ?? "").slice(0, 42);
  const headline = (q.get("headline") ?? "").slice(0, 160);
  const conf = q.get("conf") ?? "";
  const colour = COLOURS[route] ?? COLOURS.retry;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0b0f14", color: "#e6edf3", padding: 64, fontFamily: "sans-serif", borderLeft: `18px solid ${colour}` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, color: "#8b9bb0", letterSpacing: 2, textTransform: "uppercase" }}>Sent Wrong · recovery route</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 18 }}>
            <span style={{ fontSize: 34, color: colour, fontWeight: 700, textTransform: "uppercase", letterSpacing: 3 }}>{route.replace(/-/g, " ")}</span>
            <span style={{ color: "#8b9bb0", fontSize: 26 }}>{conf ? `· ${conf} confidence` : ""}</span>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.2, marginTop: 24 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 22, color: "#5b6b80" }}>
          <span style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{address}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto" }}>
          <div style={{ fontSize: 22, color: "#8B9BAB" }}>sentwrong.edycu.dev</div>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 22px", borderRadius: 999, background: "#38bdf8", color: "#05131c", fontSize: 24, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>Check an address →</div>
        </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
