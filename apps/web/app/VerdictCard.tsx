"use client";
import { useState } from "react";
import type { Verdict, Call } from "@sentwrong/core";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function CallRow({ c }: { c: Call }) {
  const state = !c.ok ? "fail" : c.cached ? "cached" : "ok";
  return (
    <div className="call">
      <span className={`dot ${state}`} />
      <span><span className="ep">{c.endpoint}</span><span className="fields">{c.ok ? c.fieldsUsed.join(", ") : c.error}</span></span>
      <span className="n">{c.credits} cr</span>
      <span className="n">{c.cached ? "cached" : `${c.ms} ms${c.attempts > 1 ? ` ×${c.attempts}` : ""}`}</span>
    </div>
  );
}

export function VerdictCard({ v, onDeep, deepBusy, shareUrl }: { v: Verdict; onDeep?: () => void; deepBusy?: boolean; shareUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const d = v.decision;
  const copy = async () => {
    try { await navigator.clipboard.writeText(v.action.text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked: the text is selectable below */ }
  };
  const failed = v.provenance.filter((c) => !c.ok && c.status !== 422).length;
  return (
    <div className={`card ${d.route}`} data-route={d.route}>
      <div className="route">
        <span className={`name ${d.route}`}>{d.route.replace(/-/g, " ")}</span>
        <span className="conf">{d.confidence} confidence{d.sub !== d.route ? ` · ${d.sub}` : ""}{d.entity ? ` · ${d.entity}` : ""}</span>
      </div>
      <h3 className="headline">{d.headline}</h3>
      <ul className="evidence">
        {d.evidence.map((e) => (
          <li key={e.code}><span className="tick">✔</span><span>{e.meaning}<span className="src">{e.field} = {e.value}</span></span></li>
        ))}
      </ul>
      {d.warnings.length > 0 && <div className="warn">{d.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
      {v.transfer && <div className="shareline">Your transfer: {v.transfer.amount} {v.transfer.symbol} on {v.transfer.date.slice(0, 10)} · <code>{v.transfer.hash}</code></div>}
      {v.deep && <div className="deep"><span className={v.deep.agrees ? "agree" : "disagree"}>Deep check (100 credits): {v.deep.labels.join(", ") || "no labels"} — {v.deep.note}</span></div>}
      {d.route !== "retry" && (
        <div className="action">
          <div className="head"><strong>{v.action.title}</strong><button onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button></div>
          <pre>{v.action.text}</pre>
        </div>
      )}
      <div className="meta">
        <span>{v.credits} credits</span><span>{v.calls} calls ({v.cachedCalls} cached{failed ? `, ${failed} failed` : ""})</span><span>{(v.ms / 1000).toFixed(1)} s</span><span>verdict {v.hash.slice(0, 12)}</span><span>as of {v.asOf.slice(0, 16).replace("T", " ")} UTC</span>
      </div>
      <div className="deep">
        {onDeep && !v.deep && <button className="ghost" onClick={onDeep} disabled={deepBusy}>{deepBusy ? "Checking…" : "Deep check — profiler/address/labels, costs 100 credits"}</button>}
        {shareUrl && <span>Share: <a href={shareUrl}>{shareUrl.replace(/^https?:\/\//, "")}</a></span>}
      </div>
      {v.rows.length > 0 && (
        <details className="drawer">
          <summary><span>Counterparties — profiler/address/counterparties, entity labels via transaction lookups</span><span>{v.rows.length} rows</span></summary>
          <table className="rows">
            <thead><tr><th>address</th><th>Nansen label</th><th>interactions</th><th>in</th><th>out</th></tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.address}><td className="mono">{short(r.address)}</td><td>{r.entityLabel ? <span className="tag entity">{r.entityLabel}</span> : <span className="tag">{r.label}</span>}</td><td className="num">{r.interactions}</td><td className="num">{usd(r.inUsd)}</td><td className="num">{usd(r.outUsd)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <details className="drawer">
        <summary><span>Provenance — every Nansen call behind this verdict</span><span>{v.calls} calls · {v.credits} credits</span></summary>
        {v.provenance.map((c, i) => <CallRow key={i} c={c} />)}
        {v.skipped.length > 0 && <div className="call"><span className="dot" /><span className="ep">skipped: {v.skipped.join(", ")}</span><span /><span /></div>}
      </details>
    </div>
  );
}
