"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { REPO } from "./Shell";
import { type RailState, type RailRun, creditsCell, hashCell, inFlight, msCell, paramSummary, statusOf, totalsOf } from "@/lib/rail";

const REDUCED = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up to its new value over 240 ms (family §7); jumps when the user prefers reduced motion. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  // the digit on screen — a new target mid-animation continues from here, never from a stale start
  const shownRef = useRef(value);
  useEffect(() => {
    const start = shownRef.current;
    if (start === value) return;
    if (REDUCED() || value < start) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 240);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (value - start) * eased);
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function RunHead({ run }: { run: RailRun }) {
  const tail = run.error ? "failed" : run.ms ? `${(run.ms / 1000).toFixed(1)} s${run.hash ? ` · ${run.hash.slice(0, 12)}` : ""}` : run.origin === "live" ? "running…" : (run.hash?.slice(0, 12) ?? "");
  return (
    <li className={`rail-run ${run.origin} ${run.error ? (run.error.startsWith("cancelled") ? "cancelled" : "failed") : ""}`}>
      <span className="rail-run-kind">{run.origin === "replayed" ? "example · replayed · 0 cr" : run.origin === "server" ? "permalink · server-side" : "live"}</span>
      <span className="rail-run-tail">{tail}</span>
      <span className="rail-run-q">{run.label}</span>
      {run.error && <span className="rail-run-error">{run.error}</span>}
    </li>
  );
}

/** endpoint names break only after `/` and `-`, never mid-word (the family's how-grid rule) */
function Endpoint({ ep }: { ep: string }) {
  return (
    <>
      {ep.split(/(?<=[/-])/).map((part, j) => (
        <span key={j}>
          {part}
          <wbr />
        </span>
      ))}
    </>
  );
}

/**
 * The Nansen call rail (family spec §13 A3): a persistent right-hand panel that streams every Nansen call the page
 * makes, as it happens — pending → live / cached / error, endpoint, params, credits, latency, response hash — with
 * counters that tick. The drawer is the receipt; this is the live meter. Every row is a real Call from the engine.
 */
export function Rail({ state, onClear }: { state: RailState; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  // the `T s` cell ticks only while a live run is in flight; nothing else re-renders for the clock
  const [now, setNow] = useState(0);
  const ticking = inFlight(state);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [ticking]);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const totals = totalsOf(state, now);
  const calls = useCountUp(totals.calls);
  const credits = useCountUp(totals.credits);
  const secs = (totals.ms / 1000).toFixed(1);

  // oldest at top, follow the newest — unless the reader has scrolled up to look at something.
  // The follow is an instant jump (no smooth scroll): an animated scroll fires intermediate scroll events that would
  // read as "the reader scrolled up" and silently stop the follow mid-run.
  const ownScroll = useRef(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    ownScroll.current = performance.now();
    el.scrollTop = el.scrollHeight;
  }, [state.rows.length, totals.calls, totals.pending]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el || performance.now() - ownScroll.current < 120) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const runsById = new Map(state.runs.map((r) => [r.id, r]));
  const items: React.ReactNode[] = [];
  const seenRun = new Set<number>();
  const head = (id: number) => {
    if (seenRun.has(id)) return;
    seenRun.add(id);
    const run = runsById.get(id);
    if (run) items.push(<RunHead key={`run-${run.id}`} run={run} />);
  };
  for (const row of state.rows) {
    // a run that failed before its first call still gets its header (and its error line)
    for (const run of state.runs) if (run.id < row.run) head(run.id);
    head(row.run);
    const run = runsById.get(row.run);
    const st = statusOf(row);
    const replayed = run?.origin === "replayed";
    items.push(
      <li key={row.key} className={`rail-row ${st}`} data-status={st}>
        <span className={`rail-dot ${st}`} aria-hidden />
        <span className="rail-main">
          <span className="rail-ep">
            <span className="rail-method">POST</span> <Endpoint ep={row.endpoint} />
          </span>
          <span className="rail-params">{paramSummary(row.endpoint, row.body)}</span>
        </span>
        <span className="rail-right">
          <span className={`rail-cr ${replayed || row.call?.cached ? "zero" : ""}`}>{creditsCell(row.call, replayed)}</span>
          <span className="rail-ms">{st === "pending" ? "…" : msCell(row.call)}</span>
          <span className="rail-hash" title={row.call?.ok ? `sha256 of the response: ${row.call.responseHash}` : row.call?.error}>
            {st === "pending" ? "pending" : hashCell(row.call)}
          </span>
        </span>
      </li>,
    );
  }
  for (const run of state.runs) head(run.id);

  return (
    <aside className={`rail ${open ? "open" : ""}`} aria-label="Nansen API calls">
      <button type="button" className="rail-bar" aria-expanded={open} aria-controls="rail-body" onClick={() => setOpen((o) => !o)}>
        <span className="kicker">Nansen API</span>
        <span className="rail-bar-text">
          Nansen calls · <b>{calls}</b> · <b>{credits}</b> cr
        </span>
        <span className="rail-bar-caret" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      <div className="rail-body" id="rail-body">
        <header className="rail-head">
          <span className="rail-head-row">
            <span className="kicker">Nansen API</span>
            <span className="rail-title">Live call log</span>
            {totals.pending > 0 && <span className="rail-pending-pill">{totals.pending} in flight</span>}
          </span>
          <span className="rail-counters" aria-label={`${totals.calls} calls, ${totals.credits} credits, ${secs} seconds`}>
            <span>
              <b>{calls}</b> calls
            </span>
            <span>
              <b>{credits}</b> cr
            </span>
            <span>
              <b>{secs}</b> s
            </span>
          </span>
        </header>
        <ol className="rail-rows" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions text" aria-atomic="false">
          {items.length > 0 ? (
            items
          ) : (
            <li className="rail-empty">
              No calls yet — press <b>Run it live now</b> or paste an address.
            </li>
          )}
        </ol>
        <footer className="rail-foot">
          <span>
            session · {totals.calls} calls · {totals.credits} credits{totals.pending ? ` · ${totals.pending} pending` : ""}
          </span>
          <span className="rail-foot-links">
            <a href={`${REPO}#-nansen-integration`} target="_blank" rel="noreferrer">
              same calls: <code>--explain</code> in the CLI
            </a>
            {state.rows.length > 0 && (
              <button type="button" className="rail-clear" onClick={onClear}>
                clear
              </button>
            )}
          </span>
        </footer>
      </div>
    </aside>
  );
}
