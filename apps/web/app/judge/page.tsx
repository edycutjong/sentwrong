import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

/**
 * /judge — a page built for exactly one reader: the person triaging submissions. No auth, no cookies, no key, no
 * redirect; static content. JUDGE.md at the repo root mirrors it. Every number here is copied from DEMO.md, the bench
 * output and the test run, and `npm run check:submission` keeps the test count in sync with the README.
 */
export const metadata: Metadata = {
  title: "Sent Wrong — for the judge",
  description: "The one-sentence claim, the 30-second click path, the real-run receipts, the reproduce command, and the honest limitations.",
};
export const dynamic = "force-static";

const APP = "https://sentwrong.edycu.dev";
const REPO = "https://github.com/edycutjong/sentwrong";
const HERO = "0xe460774c849089ee3edf0fb06da14c066caabbef";

export default function Judge() {
  return (
    <>
      <SiteHeader current="judge" />
      <main className="wrap judge">
        <p className="judge-kicker">
          <Link href="/">← the tool</Link> · for judges · no login, no key, no setup
        </p>
        <h1 className="claim">Sent crypto to the wrong address? Paste it. Nansen tells you which of four recovery routes you&apos;re on — and drafts the ticket.</h1>
        <p className="judge-lede">
          One input → one route card. The route is a decision table over Nansen fields only — no price data, no Etherscan, no local address list — and every verdict ships with the full list of Nansen
          calls that produced it.
        </p>

        <h2>The 30-second path — no setup, no key, no clone</h2>
        <ol>
          <li>
            Open{" "}
            <a href={`${APP}/q/${HERO}`}>
              {APP}/q/{HERO.slice(0, 10)}…
            </a>{" "}
            — a live verdict on a real Binance deposit address: <b>EXCHANGE DEPOSIT · high</b>, four evidence lines, each naming the Nansen endpoint and field it came from, and the prefilled Binance
            support ticket under <b>Copy</b>.
          </li>
          <li>
            Open <a href={`${APP}/q/0x000000000000000000000000000000000000dEaD`}>{APP}/q/0x0000…dEaD</a> — red <b>CONTRACT OR BURN</b>: Nansen refused the address with HTTP 422 &ldquo;Burn address not
            allowed&rdquo;, and the card says not to pay anyone who promises recovery.
          </li>
          <li>
            Open <a href={`${APP}/q/0x50b37a3ec6c04609968810801531f5021929eac9`}>{APP}/q/0x50b37a…eac9</a> — amber <b>ACTIVE STRANGER · poisoner</b>: an address-poisoning look-alike that only ever
            &ldquo;receives&rdquo; homoglyph tokens.
          </li>
          <li>
            Go to <a href={APP}>{APP}</a>, click the <b>Binance deposit address</b> example and watch the ten Nansen calls land one row at a time; then <b>Every Nansen call (10)</b> opens the
            provenance drawer: endpoint · fields · credits · ms for every call.
          </li>
        </ol>
        <p>
          Every verdict above is computed live on the server from Nansen&apos;s API when you open the link (the key stays on the server). Expect 4–13 s on a cold Vercel instance — Nansen&apos;s
          per-call latency varies by the minute.
        </p>

        <h2>Receipts — real runs, not estimates</h2>
        <table className="judge-table receipt">
          <tbody>
            <tr>
              <td>Hero verdict, cold, live</td>
              <td>
                <b>13 credits · 10 Nansen calls · 3.9 s</b> (builder, 2026-09-16 15:08 UTC) and <b>13 s</b> on an independent fresh clone (reviewer, 23:55 UTC); decision hash <code>3ea6cfcd752b</code>{" "}
                identical on both, and on the recorded fixture
              </td>
            </tr>
            <tr>
              <td>
                Benchmark (<code>npm run bench</code>)
              </td>
              <td>
                13 addresses × 3 runs, every call live: <b>39 verdicts · 309 live calls · 396 credits · 0 non-422 failures</b>; cold p50 <b>3,157 ms</b> / p95 <b>6,477 ms</b>; warm (24 h cache) p50{" "}
                <b>2 ms</b>, 0 credits, identical hash every run
              </td>
            </tr>
            <tr>
              <td>Credits spent building it</td>
              <td>
                ≈ 2,250 on the shared Meridian key across spike, seeds, bench, QA and screenshots (per-run client sums), plus ≈ 126 in the independent review. The 100-credit labels endpoint was called
                once, on purpose.
              </td>
            </tr>
            <tr>
              <td>Tests</td>
              <td>
                <b>196 vitest tests</b> in 9 s, of which <b>11 regression tests named after the defect they pin</b> (e.g. &ldquo;a transactions timeout read as &lsquo;nothing on record&rsquo;&rdquo;),
                plus <b>13 fixtures</b> recorded live and replayed offline 13/13 with the same decision hash
              </td>
            </tr>
            <tr>
              <td>Property-based verification</td>
              <td>
                <b>40,000 generated Nansen response sets</b> (fast-check, 4 properties × 10,000 runs) through <code>classify()</code>: exactly one of the five routes every time; a failed{" "}
                <code>transactions</code> lookup never becomes a stranger verdict; the decision hash is invariant to USD prices; the function is pure. All 14 route/sub-state pairs reached.
              </td>
            </tr>
            <tr>
              <td>Boundary tests</td>
              <td>
                The server key never appears in the verdict JSON, the streamed provenance, an error message or the fixtures; every malformed address is rejected with zero network calls. Backed by 8
                unit tests and 4 Playwright suites that run with no key at all.
              </td>
            </tr>
            <tr>
              <td>Timed clean clone</td>
              <td>install 6 s · live hero verdict 13 s · offline verify 1 s · tests 3 s · dev server first 200 in 4 s (independent reviewer, two clones)</td>
            </tr>
          </tbody>
        </table>

        <h2>Reproduce — the real path</h2>
        <pre className="cmd">{`git clone ${REPO} && cd sentwrong && npm install
export NANSEN_API_KEY=nsn_…            # https://app.nansen.ai/api — free tier works, this costs 13 credits
npm run sentwrong -- ${HERO} --explain`}</pre>
        <p>
          You get the verdict, the four evidence lines with their Nansen fields, the ticket, and the call-by-call provenance (endpoint · credits · ms · fields read). Web app:{" "}
          <code>npm run dev -w apps/web</code>.
        </p>
        <p>
          <b>CI / deterministic replay (not the product):</b> <code>npm run verify</code> replays the 13 recorded fixtures with <code>NANSEN_OFFLINE=1</code> — zero network, zero credits, every
          decision hash must match. It exists so CI and a reader without a key can watch the engine decide; the CLI and the web app hit Nansen live by default.
        </p>

        <h2>Honest limitations</h2>
        <ol>
          <li>
            Nansen&apos;s per-call latency varies 0.3–3 s by the minute, so a cold verdict takes 4–13 s. On Vercel the 24 h cache is in-memory per function instance — a cold start is fully live.
            Locally the cache is on disk.
          </li>
          <li>
            &ldquo;Nothing on record&rdquo; cannot tell a brand-new address from one Nansen does not index: vitalik.eth returns empty profiler pages and comes back as a low-confidence <i>fresh</i>{" "}
            stranger. The card says so instead of promising that waiting will help.
          </li>
          <li>
            Ethereum is the deeply exercised chain; the other seven EVM chains go through the same endpoints but only base has been checked live. The flagship <code>profiler/address/labels</code>{" "}
            endpoint (100 credits) is opt-in (<code>--deep</code>) and Smart Money endpoints are absent on purpose — the beneficiary is a person who lost money, not a trader.
          </li>
        </ol>

        <h2>Links</h2>
        <ul>
          <li>
            Live app: <a href={APP}>{APP}</a>
          </li>
          <li>
            Repository: <a href={REPO}>{REPO}</a> — <a href={`${REPO}/blob/main/DEMO.md`}>DEMO.md</a> (verbatim hero output + bench) · <a href={`${REPO}/blob/main/docs/SCORING.md`}>docs/SCORING.md</a>{" "}
            (the decision table) · <a href={`${REPO}/blob/main/ARCHITECTURE.md`}>ARCHITECTURE.md</a> · <a href={`${REPO}/blob/main/docs/DX-REPORT.md`}>Nansen API friction log</a>
          </li>
          <li>
            Latest release: <a href={`${REPO}/releases/latest`}>{REPO}/releases/latest</a> · CI: <a href={`${REPO}/actions`}>{REPO}/actions</a>
          </li>
          <li>Demo recording: the X post from @edycutjong tagging @nansen_ai (published at submission).</li>
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
