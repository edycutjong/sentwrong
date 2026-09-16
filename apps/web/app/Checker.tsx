"use client";
import { useState, useRef } from "react";
import type { Verdict, Call } from "@sentwrong/core";
import { VerdictCard, CallRow } from "./VerdictCard";

const CHAINS = ["ethereum", "base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "linea"];
const EXAMPLES: Array<{ label: string; address: string; sender?: string }> = [
  { label: "Binance deposit address", address: "0xe460774c849089ee3edf0fb06da14c066caabbef" },
  { label: "burn address", address: "0x000000000000000000000000000000000000dEaD" },
  { label: "USDC contract", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { label: "poisoning look-alike", address: "0x50b37a3ec6c04609968810801531f5021929eac9" },
  { label: "your own wallet", address: "0x3ff462b155011159f9afe68b0a3c509dc6f462b0", sender: "0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5" },
];

type Line = { type: "call"; call: Call } | { type: "verdict"; verdict: Verdict } | { type: "error"; message: string };

export default function Checker({ initial }: { initial?: { address?: string; sender?: string; chain?: string } }) {
  const [address, setAddress] = useState(initial?.address ?? "");
  const [sender, setSender] = useState(initial?.sender ?? "");
  const [chain, setChain] = useState(initial?.chain ?? "ethereum");
  const [showSender, setShowSender] = useState(!!initial?.sender);
  const [calls, setCalls] = useState<Call[]>([]);
  const [verdict, setVerdict] = useState<Verdict | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [deepBusy, setDeepBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function run(deep = false) {
    abort.current?.abort();
    const ctrl = new AbortController(); abort.current = ctrl;
    setError(undefined); setCalls([]); if (!deep) setVerdict(undefined); // a deep re-run streams its (cached) calls plus the labels call
    deep ? setDeepBusy(true) : setBusy(true);
    try {
      const res = await fetch("/api/verdict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: address.trim(), sender: showSender && sender.trim() ? sender.trim() : undefined, chain, deep }), signal: ctrl.signal });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({ message: res.statusText })); throw new Error(j.message ?? `HTTP ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const o = JSON.parse(line) as Line;
          if (o.type === "call") setCalls((cs) => [...cs, o.call]);
          else if (o.type === "verdict") setVerdict(o.verdict);
          else if (o.type === "error") setError(o.message);
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") setError((e as Error).message); }
    finally { setBusy(false); setDeepBusy(false); }
  }

  const shareUrl = verdict && typeof window !== "undefined" ? `${window.location.origin}/q/${verdict.address}${verdict.sender ? `?from=${verdict.sender}` : ""}${verdict.chain !== "ethereum" ? `${verdict.sender ? "&" : "?"}chain=${verdict.chain}` : ""}` : undefined;

  return (
    <>
      <form className="check" onSubmit={(e) => { e.preventDefault(); if (!busy) run(); }}>
        <div className="row2">
          <div className="field"><label htmlFor="address">The address you sent to</label><input id="address" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" autoFocus /></div>
          <div className="field"><label htmlFor="chain">Chain</label><select id="chain" value={chain} onChange={(e) => setChain(e.target.value)}>{CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        {showSender && <div className="field"><label htmlFor="sender">Your address (optional — lets us check whether the recipient is linked to you and find your transfer)</label><input id="sender" placeholder="0x…" value={sender} onChange={(e) => setSender(e.target.value)} spellCheck={false} autoComplete="off" /></div>}
        <div className="actions">
          <button type="submit" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())}>{busy ? "Asking Nansen…" : "Where did it go?"}</button>
          <button type="button" className="ghost" onClick={() => setShowSender((s) => !s)}>{showSender ? "Hide my address" : "+ my address"}</button>
        </div>
        <div className="examples">
          {EXAMPLES.map((x) => <button type="button" key={x.address + (x.sender ?? "")} onClick={() => { setAddress(x.address); setChain("ethereum"); if (x.sender) { setSender(x.sender); setShowSender(true); } else { setSender(""); setShowSender(false); } }}>{x.label}</button>)}
        </div>
      </form>
      {error && <div className="err">{error}</div>}
      {(calls.length > 0 || busy) && (
        <section className="calls">
          <h2 className="small">What Nansen sees{busy ? " — live" : ""}</h2>
          {calls.map((c, i) => <CallRow key={i} c={c} />)}
          {busy && <div className="call"><span className="dot pending" /><span className="ep">waiting for Nansen…</span><span /><span /></div>}
        </section>
      )}
      {verdict && <VerdictCard v={verdict} onDeep={() => run(true)} deepBusy={deepBusy} shareUrl={shareUrl} />}
    </>
  );
}
