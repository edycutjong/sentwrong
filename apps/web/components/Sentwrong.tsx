"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Verdict, Call } from "@sentwrong/core";
import type { ExampleVerdict } from "@/lib/example";
import { Card, short } from "./Card";
import { Drawer } from "./Drawer";
import { Example, HowItDecides } from "./Example";

const CHAINS = ["ethereum", "base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "linea"];
const EVM = /^0x[0-9a-fA-F]{40}$/;
/** the five recorded edges a judge should click — each is a fixture, each replays in `npm run verify` */
const EXAMPLES: Array<{ label: string; address: string; sender?: string }> = [
  { label: "Binance deposit address", address: "0xe460774c849089ee3edf0fb06da14c066caabbef" },
  { label: "burn address", address: "0x000000000000000000000000000000000000dEaD" },
  { label: "USDC contract", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { label: "poisoning look-alike", address: "0x50b37a3ec6c04609968810801531f5021929eac9" },
  { label: "your own wallet", address: "0x3ff462b155011159f9afe68b0a3c509dc6f462b0", sender: "0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5" },
];
/** a cold hero verdict is 10 calls — the progress bar's denominator until the verdict lands */
const EXPECTED_CALLS = 10;

type Phase = "idle" | "running" | "done" | "error";
type Line = { type: "call"; call: Call } | { type: "verdict"; verdict: Verdict } | { type: "error"; message: string };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function CallRow({ c }: { c: Call }) {
  const state = !c.ok ? (c.status === 422 ? "ok" : "fail") : c.cached ? "cached" : "ok";
  return (
    <div className="call">
      <span className={`dot ${state}`} />
      <span>
        <span className="ep">{c.endpoint}</span>
        <span className="fields">{c.ok ? c.fieldsUsed.join(", ") : c.error}</span>
      </span>
      <span className="n">{c.credits} cr</span>
      <span className="n">{c.cached ? "cached" : `${c.ms} ms${c.attempts > 1 ? ` ×${c.attempts}` : ""}`}</span>
    </div>
  );
}

function bannerFor(v: Verdict): { kind: "ok" | "warn" | "err"; text: string } {
  const d = v.decision;
  const e = d.entity ?? "the exchange";
  switch (d.route) {
    case "exchange-deposit":
      return d.sub === "exchange-wallet"
        ? { kind: "ok", text: `Recoverable only through ${e} support — this is ${e}'s own wallet` }
        : { kind: "ok", text: `Recoverable — a ${e} deposit address · the support ticket is ready to copy` };
    case "your-own-wallet":
      return { kind: "ok", text: "Nothing is lost — this wallet is linked to yours" };
    case "active-stranger":
      return d.sub === "poisoner"
        ? { kind: "err", text: "An address-poisoning scam address — report it, do not chase it" }
        : { kind: "warn", text: "An unlabelled wallet — odds are low; the memo costs nothing" };
    case "contract-or-burn":
      return { kind: "err", text: "Unrecoverable — do not pay anyone who promises recovery" };
    default:
      return { kind: "warn", text: "No verdict — Nansen did not answer; retry in a minute" };
  }
}

export function Sentwrong({
  initialAddress,
  initialSender,
  initialChain,
  initialVerdict,
  initialError,
  examples,
}: {
  initialAddress?: string;
  initialSender?: string;
  initialChain?: string;
  /** the /q permalink: computed server-side so the share card and the page agree */
  initialVerdict?: Verdict;
  /** the /q permalink when the server could not compute it (no key, Nansen down): the honest error, never a fabricated verdict */
  initialError?: string;
  examples: ExampleVerdict[];
}) {
  const [address, setAddress] = useState(initialAddress ?? "");
  const [sender, setSender] = useState(initialSender ?? "");
  const [chain, setChain] = useState(initialChain && CHAINS.includes(initialChain) ? initialChain : "ethereum");
  const [showSender, setShowSender] = useState(!!initialSender);
  const [phase, setPhase] = useState<Phase>(initialVerdict ? "done" : initialError ? "error" : initialAddress && EVM.test(initialAddress) ? "running" : "idle");
  const [calls, setCalls] = useState<Call[]>(initialVerdict?.provenance ?? []);
  const [verdict, setVerdict] = useState<Verdict | undefined>(initialVerdict);
  const [error, setError] = useState<string | undefined>(initialError);
  const [deepBusy, setDeepBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** POST /api/verdict and parse the NDJSON stream; state changes happen only after the first await. */
  const stream = useCallback(async (a: string, s: string | undefined, ch: string, deep: boolean) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (typeof history !== "undefined") history.replaceState(null, "", `/?address=${a}${s ? `&from=${s}` : ""}${ch !== "ethereum" ? `&chain=${ch}` : ""}`);
    try {
      const res = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: a, sender: s, chain: ch, deep }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawVerdict = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const o = JSON.parse(line) as Line;
          if (o.type === "call") setCalls((cs) => [...cs, o.call]);
          else if (o.type === "verdict") {
            sawVerdict = true;
            setVerdict(o.verdict);
            setPhase("done");
          } else if (o.type === "error") throw new Error(o.message);
        }
      }
      if (!sawVerdict) throw new Error("the stream ended before a verdict arrived — try again");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
      setPhase("error");
    } finally {
      setDeepBusy(false);
    }
  }, []);

  /** A user-initiated run: reset the verdict state, then stream. `deep` re-runs with the 100-credit labels call added. */
  const run = useCallback(
    (a: string, s: string | undefined, ch: string, deep = false) => {
      const addr = a.trim();
      if (!EVM.test(addr)) return;
      const from = s?.trim() || undefined;
      setError(undefined);
      setCalls([]);
      setDrawer(false);
      if (deep) setDeepBusy(true);
      else {
        setVerdict(undefined);
        setPhase("running");
      }
      void stream(addr, from, ch, deep);
    },
    [stream],
  );

  useEffect(() => {
    // /?address=… (the permalink's "run it again" link) streams on mount; stream() only sets state after `await fetch`
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialAddress && EVM.test(initialAddress) && !initialVerdict && !initialError) void stream(initialAddress, initialSender || undefined, chain, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2300);
  };
  const copyAction = async () => {
    if (!verdict) return;
    try {
      await navigator.clipboard.writeText(verdict.action.text);
      say(`copied · ${verdict.action.title}`);
    } catch {
      say("copy failed — select the text");
    }
  };
  const share = async () => {
    if (!verdict) return;
    const url = `${location.origin}/q/${verdict.address}${verdict.sender ? `?from=${verdict.sender}` : ""}${verdict.chain !== "ethereum" ? `${verdict.sender ? "&" : "?"}chain=${verdict.chain}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      say("share link copied");
    } catch {
      say(url);
    }
  };

  const busy = phase === "running";
  const creditsSoFar = calls.reduce((n, c) => n + c.credits, 0);
  const failed = verdict ? verdict.provenance.filter((c) => !c.ok && c.status !== 422).length : 0;
  const status = busy
    ? `asking Nansen… ${calls.length} call${calls.length === 1 ? "" : "s"} · ${creditsSoFar} credits`
    : phase === "done" && verdict
      ? `${verdict.credits} credits · ${verdict.calls} calls (${verdict.cachedCalls} cached${failed ? `, ${failed} failed` : ""}) · ${(verdict.ms / 1000).toFixed(1)} s · verdict ${verdict.hash.slice(0, 12)}`
      : "";
  const banner = verdict ? bannerFor(verdict) : null;

  return (
    <main className="wrap">
      <header className="hero">
        <h1>
          Where did it <span className="real">go</span>?
        </h1>
        <p>Paste the address you sent to. Nansen labels decide which of four recovery routes you&rsquo;re on — and draft the ticket.</p>
      </header>

      <div className="panel">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) run(address, showSender ? sender : undefined, chain);
          }}
        >
          <input
            className="mono"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… the address you sent to — not the tx hash"
            aria-label="The address you sent to"
            autoFocus
            maxLength={42}
            spellCheck={false}
            autoComplete="off"
          />
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain">
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !EVM.test(address.trim())}>
            Check
          </button>
        </form>
        {showSender && (
          <div className="search">
            <input
              className="mono"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="0x… your own address (optional)"
              aria-label="Your address (optional) — checks whether the recipient is linked to you and finds your transfer"
              maxLength={42}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
        <div className="chips" role="group" aria-label="examples">
          {EXAMPLES.map((x) => (
            <button
              key={x.address}
              type="button"
              className="chip"
              onClick={() => {
                setAddress(x.address);
                setChain("ethereum");
                setSender(x.sender ?? "");
                setShowSender(!!x.sender);
                run(x.address, x.sender, "ethereum");
              }}
            >
              {x.label}
            </button>
          ))}
          <button type="button" className={`chip ${showSender ? "on" : ""}`} onClick={() => setShowSender((s) => !s)} aria-pressed={showSender}>
            {showSender ? "− my address" : "+ my address"}
          </button>
        </div>
      </div>

      <div className={`progress ${phase === "idle" ? "hidden" : ""}`}>
        <i style={{ width: busy ? `${8 + Math.min(92, (calls.length / EXPECTED_CALLS) * 92)}%` : phase === "done" ? "100%" : "0%" }} />
      </div>
      <p className={`status ${phase === "idle" ? "hidden" : ""}`} aria-live="polite">
        {status}
      </p>

      {phase === "error" && (
        <div className="banner err">
          Nansen lookup failed<small>{error}</small>
        </div>
      )}
      {verdict && banner && (
        <div className={`banner ${banner.kind}`}>
          {banner.text}
          {verdict.decision.warnings.length > 0 && <small>{verdict.decision.warnings.join(" · ")}</small>}
        </div>
      )}

      {(busy || (verdict && calls.length > 0)) && (
        <section className="calls" aria-label="Nansen calls as they land">
          {calls.map((c, i) => (
            <CallRow key={i} c={c} />
          ))}
          {busy && (
            <div className="call">
              <span className="dot pending" />
              <span className="ep">waiting for Nansen…</span>
              <span />
              <span />
            </div>
          )}
        </section>
      )}

      {verdict && (
        <>
          <Card v={verdict}>
            {verdict.transfer && (
              <div className="transfer">
                Your transfer: {verdict.transfer.amount} {verdict.transfer.symbol} on {verdict.transfer.date.slice(0, 10)} · <code>{verdict.transfer.hash}</code>
              </div>
            )}
            {verdict.deep && (
              <div className="deep-note">
                <span className={verdict.deep.agrees ? "agree" : "disagree"}>
                  Deep check (100 credits): {verdict.deep.labels.join(", ") || "no labels"} — {verdict.deep.note}
                </span>
              </div>
            )}
            {verdict.decision.route !== "retry" && (
              <div className="action-block">
                <div className="head">
                  <strong>{verdict.action.title}</strong>
                  <button className="btn primary" onClick={copyAction}>
                    Copy
                  </button>
                </div>
                <pre>{verdict.action.text}</pre>
              </div>
            )}
            <div className="meta">
              <span>{verdict.credits} credits</span>
              <span>
                {verdict.calls} calls ({verdict.cachedCalls} cached{failed ? `, ${failed} failed` : ""})
              </span>
              <span>{(verdict.ms / 1000).toFixed(1)} s</span>
              <span>verdict {verdict.hash.slice(0, 12)}</span>
              <span>as of {verdict.asOf.slice(0, 16).replace("T", " ")} UTC</span>
            </div>
            {verdict.rows.length > 0 && (
              <details className="rows-details">
                <summary>
                  <span>Counterparties — profiler/address/counterparties, entity labels via transaction lookups</span>
                  <span>{verdict.rows.length} rows</span>
                </summary>
                <table className="rows">
                  <thead>
                    <tr>
                      <th>address</th>
                      <th>Nansen label</th>
                      <th>interactions</th>
                      <th>in</th>
                      <th>out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verdict.rows.map((r) => (
                      <tr key={r.address}>
                        <td className="mono">{short(r.address)}</td>
                        <td>{r.entityLabel ? <span className="tag entity">{r.entityLabel}</span> : <span className="tag">{r.label}</span>}</td>
                        <td className="num">{r.interactions}</td>
                        <td className="num">{usd(r.inUsd)}</td>
                        <td className="num">{usd(r.outUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </Card>
          <div className="actions" style={{ justifyContent: "center", marginTop: 20 }}>
            <button className="btn" onClick={() => setDrawer(true)}>
              Every Nansen call ({verdict.calls})
            </button>
            {!verdict.deep && (
              <button className="btn" onClick={() => run(verdict.address, verdict.sender, verdict.chain, true)} disabled={deepBusy}>
                {deepBusy ? "Checking…" : "Deep check — profiler/address/labels, costs 100 credits"}
              </button>
            )}
            <button className="btn" onClick={share}>
              Share this verdict
            </button>
          </div>
        </>
      )}

      {phase === "idle" && examples.length > 0 && (
        <Example
          examples={examples}
          onRun={(x) => {
            setAddress(x.address);
            setChain(x.chain);
            setSender(x.sender ?? "");
            setShowSender(!!x.sender);
            run(x.address, x.sender, x.chain);
          }}
        />
      )}
      {phase === "idle" && <HowItDecides />}

      <Drawer
        calls={verdict?.provenance ?? []}
        skipped={verdict?.skipped ?? []}
        open={drawer}
        onClose={() => setDrawer(false)}
        credits={verdict?.credits ?? 0}
        ms={verdict?.ms ?? 0}
        asOf={verdict?.asOf}
        hash={verdict?.hash}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
