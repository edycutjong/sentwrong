"use client";
import type { Decision, Evidence, Route } from "@sentwrong/core";

/** What a card needs to draw a route: the address it was asked about and the decision Nansen's fields produced. */
export type RouteView = {
  address: string;
  chain: string;
  decision: Pick<Decision, "route" | "sub" | "confidence" | "entity" | "headline" | "evidence" | "warnings">;
};

export type CardState = "winner" | "impostor" | "warn" | "muted";

export function short(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Green = recoverable (the family's "answer"); red = do not; amber = low odds; muted = no verdict. */
export function stateOf(d: RouteView["decision"]): CardState {
  if (d.route === "exchange-deposit" || d.route === "your-own-wallet") return "winner";
  if (d.route === "contract-or-burn" || d.sub === "poisoner") return "impostor";
  if (d.route === "active-stranger") return "warn";
  return "muted";
}

export function badgeOf(d: RouteView["decision"]): string {
  if (d.route === "exchange-deposit") return "recoverable";
  if (d.route === "your-own-wallet") return "still yours";
  if (d.route === "contract-or-burn") return "unrecoverable";
  if (d.sub === "poisoner") return "scam address";
  if (d.route === "active-stranger") return "low odds";
  return "no verdict";
}

/** The card title: the route in the words a person who lost money uses. */
export function titleOf(d: RouteView["decision"]): string {
  const e = d.entity;
  const by: Record<Route, () => string> = {
    "exchange-deposit": () => (d.sub === "exchange-wallet" ? `${e}'s own wallet` : `${e ?? "Exchange"} deposit address`),
    "your-own-wallet": () => "Your own wallet",
    "active-stranger": () => (d.sub === "poisoner" ? "Address-poisoning look-alike" : d.sub === "fresh" ? "Nothing on record" : d.sub === "dormant" ? "Dormant stranger" : "Active stranger"),
    "contract-or-burn": () =>
      d.sub === "burn" ? "Burn address" : d.sub === "token-contract" ? `${e ?? ""} token contract`.trim() : d.sub === "forwarder" ? `Forwarder into ${e}` : `Smart contract${e ? ` · ${e}` : ""}`,
    retry: () => "No verdict — retry",
  };
  return by[d.route]();
}

/** One evidence line as a fact chip (the compact card): the Nansen value with a two-word prefix. */
export function factOf(e: Evidence): string {
  const v = e.value.length > 44 ? `${e.value.slice(0, 42)}…` : e.value;
  switch (e.code) {
    case "OWN_DEPOSIT_LABEL":
    case "OWN_EXCHANGE_LABEL":
      return `labelled ${v}`;
    case "SWEEP_TO_EXCHANGE":
      return `swept to ${v}`;
    case "OUTFLOW_CONCENTRATED":
      return `outflow ${v}`;
    case "FUNDED_BY_EXCHANGE":
      return `first gas from ${v}`;
    case "BURN_422":
      return `HTTP 422 · ${v}`;
    case "FUNDED_BY_SENDER":
      return `first funded by ${v}`;
    case "RELATED_TO_SENDER":
      return `related wallet · ${v}`;
    case "DEPLOYED_BY":
      return `deployed by ${v}`;
    default:
      return v;
  }
}

export function Card({
  v,
  compact,
  plain,
  children,
}: {
  v: RouteView;
  compact?: boolean;
  /** example grid: only the hero carries the green winner frame — a second recoverable route keeps its badge but no frame */
  plain?: boolean;
  children?: React.ReactNode;
}) {
  const d = v.decision;
  const real = stateOf(d);
  const state = plain && real === "winner" ? "" : real;
  const badgeClass = real === "winner" ? "real" : real === "impostor" ? "impostor" : real === "warn" ? "warn" : "muted";
  return (
    <article className={`card ${state} ${compact ? "compact" : ""}`} data-route={d.route} data-id={v.address} aria-label={`${titleOf(d)} — ${short(v.address)}`}>
      <div className="top">
        <span className="name">
          {titleOf(d)}{" "}
          <span className="sym conf">
            {d.confidence}
            {d.sub !== d.route ? ` · ${d.sub}` : ""}
          </span>
        </span>
        <span className="badge chain">{v.chain}</span>
        <span className={`badge ${badgeClass}`}>{badgeOf(d)}</span>
      </div>
      <div className="addr">{compact && state !== "winner" ? short(v.address) : <b>{v.address}</b>}</div>
      {!compact && <p className="headline">{d.headline}</p>}
      {compact ? (
        <div className="facts">
          {d.evidence.slice(0, 4).map((e) => (
            <span className="fact" key={e.code} title={`${e.field} = ${e.value}`}>
              {factOf(e)}
            </span>
          ))}
        </div>
      ) : (
        <ul className="evidence">
          {d.evidence.map((e) => (
            <li key={e.code}>
              <span className="tick">✔</span>
              <span>
                {e.meaning}
                <span className="src">
                  {e.field} = {e.value}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!compact && d.warnings.length > 0 && (
        <div className="warnings">
          {d.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {children}
    </article>
  );
}
