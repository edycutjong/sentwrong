"use client";
import type { ExampleVerdict } from "@/lib/example";
import { Card, short, titleOf } from "./Card";

export const FIXTURE_COUNT = 13;

/**
 * The empty state shows the payoff before anyone pastes: four recorded verdicts (fixtures/*.json, live 2026-09-16,
 * replayed at 0 credits, labelled), the hero Binance deposit address first and green. "Run it live now" replaces it
 * with the live run of the same address.
 */
export function Example({ examples, onRun }: { examples: ExampleVerdict[]; onRun: (x: ExampleVerdict) => void }) {
  const hero = examples[0];
  return (
    <section className="example" aria-labelledby="example-h">
      <div className="example-head">
        <div>
          <h2 id="example-h">
            <span className="kicker">example</span> {short(hero.address)} — a {titleOf(hero.decision)}
          </h2>
          <p className="example-sub">
            {hero.live.calls} Nansen calls · recorded {hero.recordedAt} · replayed from{" "}
            <code title={`fixtures/${hero.file}`}>
              fixtures/{short(hero.address)}
              {hero.sender ? "--from-…" : ""}.json
            </code>{" "}
            · 0 credits · <code>{hero.hash.slice(0, 12)}</code>
          </p>
        </div>
        <button className="btn primary" onClick={() => onRun(hero)}>
          Run it live now
        </button>
      </div>
      <div className="grid">
        {examples.map((x, i) => (
          <Card key={x.file} v={x} compact plain={i > 0} />
        ))}
      </div>
      <p className="example-more">
        + {FIXTURE_COUNT - examples.length} more recorded verdicts in <code>npm run verify</code> · {FIXTURE_COUNT}/{FIXTURE_COUNT} decision hashes reproduce offline
      </p>
    </section>
  );
}

export function HowItDecides() {
  // the endpoints packages/core/src/nansen.ts calls in the default path, credits from client.ts CREDITS / docs/SCORING.md
  const steps = [
    { ep: "search/general", cr: "0 cr", what: "is a token contract deployed at this address?", decides: "contract route at 0 credits, search over" },
    {
      ep: "profiler/address/transactions",
      cr: "1–2 cr",
      what: "transfers in and out, the sweep hashes; HTTP 422 = burn",
      decides: "burn, dormant, poisoning, which txs to look up (+1 cr all-time page when quiet)",
    },
    { ep: "profiler/address/counterparties", cr: "5 cr", what: "who it pays and how much of the outflow", decides: "100 % to one wallet = the sweep signature" },
    { ep: "profiler/address/related-wallets", cr: "1–2 cr", what: "Deployed by, Created by, First Funder relations", decides: "contract vs your own wallet (+1 cr on your address)" },
    { ep: "profiler/address/first-funder", cr: "1 cr", what: "who paid its first gas, and in which tx", decides: "exchange gas dripper vs you" },
    { ep: "transaction-with-token-transfer-lookup", cr: "1 cr × ≤4", what: "entity labels on the transfer: 🏦 Binance: Deposit", decides: "the route" },
  ];
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h">How it decides — six Nansen endpoints, first matching rule wins</h2>
      <ol className="how-grid">
        {steps.map((s, i) => (
          <li key={s.ep} className="how-step">
            <span className="how-n">{i + 1}</span>
            <code className="how-ep">
              {s.ep.split(/(?<=[/-])/).map((part, j) => (
                <span key={j}>
                  {part}
                  <wbr />
                </span>
              ))}
            </code>
            <span className="how-cr">{s.cr}</span>
            <p>{s.what}</p>
            <p className="how-decides">→ {s.decides}</p>
          </li>
        ))}
      </ol>
      <ul className="proof-row" aria-label="proof">
        <li>
          <b>10.2</b> credits per verdict · max <b>13</b>
        </li>
        <li>
          <b>3.2 s</b> cold p50 · <b>2 ms</b> warm
        </li>
        <li>
          <b>13/13</b> verdicts replay offline
        </li>
        <li>
          <b>188</b> tests · <b>40,000</b> property cases
        </li>
      </ul>
    </section>
  );
}
