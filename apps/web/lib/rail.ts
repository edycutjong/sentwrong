/**
 * The Nansen call rail — pure state for the live call log that sits to the right of the page.
 *
 * Every row is a real `Call` from the engine's own provenance stream (the same objects the drawer prints): a `start`
 * event opens a pending row, the matching `end` event fills it with the finished Call. Nothing is synthesised. The
 * recorded example seeds the rail on load with its replayed calls (cached, 0 credits), labelled as such.
 */
import type { Call, CallStart } from "@sentwrong/core";

/** Rows the rail can hold before the oldest are dropped (a session, not a database). */
export const RAIL_CAP = 200;

export type RailRun = {
  id: number;
  /** what was asked — short address, chain, optional sender */
  label: string;
  /** `replayed` = a recorded fixture at 0 credits; `live` = the page's own /api/verdict stream; `server` = computed for a permalink */
  origin: "replayed" | "live" | "server";
  startedAt: number;
  /** wall time of the whole run, set when the verdict lands (matches the drawer's `T s` exactly) */
  ms?: number;
  hash?: string;
  /** set when the stream broke before a verdict — the run's own error line */
  error?: string;
};

export type RailRow = {
  key: string;
  run: number;
  seq: number;
  endpoint: string;
  body: Record<string, unknown>;
  startedAt: number;
  /** undefined while pending */
  call?: Call;
};

export type RailState = { runs: RailRun[]; rows: RailRow[]; next: number };

export const EMPTY_RAIL: RailState = { runs: [], rows: [], next: 1 };

export type RowStatus = "pending" | "live" | "cached" | "error";

/** live 200 = green · cached / replayed = hollow grey · anything not ok = red · nothing yet = pending */
export function statusOf(row: Pick<RailRow, "call">): RowStatus {
  const c = row.call;
  if (!c) return "pending";
  if (!c.ok && c.status !== 422) return "error";
  if (c.cached) return "cached";
  return "live";
}

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** A one-line, key-free summary of a request body: `0xe460…bbef · ethereum · 14 d`. Never the full body. */
export function paramSummary(endpoint: string, body: Record<string, unknown>): string {
  const parts: string[] = [];
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  if (s("search_query")) parts.push(`“${shortAddr(s("search_query")!)}”`);
  if (s("address")) parts.push(shortAddr(s("address")!));
  if (s("transaction_hash")) parts.push(`tx ${shortAddr(s("transaction_hash")!)}`);
  if (s("chain")) parts.push(s("chain")!);
  const date = body.date as { from?: string; to?: string } | undefined;
  if (date?.from && date?.to) {
    const days = Math.round((Date.parse(date.to) - Date.parse(date.from)) / 86_400_000);
    parts.push(days > 3650 ? "all time" : `${days} d`);
  }
  const pg = body.pagination as { per_page?: number } | undefined;
  if (pg?.per_page && endpoint !== "profiler/address/related-wallets") parts.push(`top ${pg.per_page}`);
  return parts.join(" · ");
}

/** The right-hand cluster's third cell: the response hash for a good call, the status for a bad one. */
export function hashCell(c: Call | undefined): string {
  if (!c) return "…";
  if (!c.ok) return c.status ? `HTTP ${c.status}` : (c.error ?? "failed").slice(0, 12);
  return c.responseHash ? c.responseHash.slice(0, 8) : "—";
}

export function creditsCell(c: Call | undefined, replayed: boolean): string {
  if (!c) return "…";
  if (replayed) return "0 cr · replayed";
  if (c.cached) return "0 cr · cached";
  return `${c.credits} cr`;
}

export function msCell(c: Call | undefined): string {
  if (!c) return "";
  if (c.cached) return "0 ms";
  if (!c.ok) return c.totalMs ? `${c.totalMs} ms` : "";
  return `${c.ms} ms${c.attempts > 1 ? ` ×${c.attempts}` : ""}`;
}

export type RailTotals = { calls: number; credits: number; ms: number; pending: number };

/** Session totals — credits and calls over every row; time = the wall time of each finished run (the drawer's number). */
export function totalsOf(state: RailState, now: number): RailTotals {
  let calls = 0,
    credits = 0,
    pending = 0;
  for (const r of state.rows) {
    if (r.call) {
      calls++;
      credits += r.call.credits;
    } else pending++;
  }
  let ms = 0;
  for (const run of state.runs) ms += run.ms ?? (run.origin === "live" && state.rows.some((r) => r.run === run.id && !r.call) ? Math.max(0, now - run.startedAt) : 0);
  return { calls, credits, ms, pending };
}

function cap(state: RailState): RailState {
  if (state.rows.length <= RAIL_CAP) return state;
  const rows = state.rows.slice(state.rows.length - RAIL_CAP);
  const live = new Set(rows.map((r) => r.run));
  const newest = state.runs[state.runs.length - 1]?.id;
  return { ...state, runs: state.runs.filter((r) => live.has(r.id) || r.id === newest), rows };
}

export function beginRun(state: RailState, label: string, origin: RailRun["origin"], now: number): { state: RailState; run: number } {
  const id = state.next;
  return { state: { runs: [...state.runs, { id, label, origin, startedAt: now }], rows: state.rows, next: id + 1 }, run: id };
}

export function startCall(state: RailState, run: number, start: CallStart, now: number): RailState {
  const row: RailRow = { key: `${run}:${start.seq}`, run, seq: start.seq, endpoint: start.endpoint, body: start.body, startedAt: now };
  return cap({ ...state, rows: [...state.rows, row] });
}

/** Fill the pending row `seq` opened by `startCall`; a Call that never announced itself (a server-rendered verdict) gets its own row. */
export function endCall(state: RailState, run: number, seq: number, call: Call, now: number): RailState {
  const key = `${run}:${seq}`;
  const i = state.rows.findIndex((r) => r.key === key);
  if (i < 0) return cap({ ...state, rows: [...state.rows, { key, run, seq, endpoint: call.endpoint, body: call.body, startedAt: now, call }] });
  const rows = state.rows.slice();
  rows[i] = { ...rows[i], call };
  return { ...state, rows };
}

/** The verdict landed: stamp the run with the wall time and hash the drawer will print. */
export function finishRun(state: RailState, run: number, ms: number, hash?: string): RailState {
  return { ...state, runs: state.runs.map((r) => (r.id === run ? { ...r, ms, hash } : r)) };
}

/** The stream broke: rows still pending in this run are closed as failed so nothing pulses forever. */
export function failRun(state: RailState, run: number, error: string): RailState {
  return {
    ...state,
    runs: state.runs.map((r) => (r.id === run ? { ...r, error } : r)),
    rows: state.rows.map((r) =>
      r.run === run && !r.call
        ? { ...r, call: { endpoint: r.endpoint, body: r.body, credits: 0, ms: 0, cached: false, status: 0, fieldsUsed: [], responseHash: "", attempts: 1, totalMs: 0, ok: false, error } }
        : r,
    ),
  };
}

/** Seed a whole run from finished provenance (the recorded example on load, or a permalink's server-side verdict). */
export function seedRun(state: RailState, label: string, origin: RailRun["origin"], calls: Call[], now: number, ms?: number, hash?: string): RailState {
  const begun = beginRun(state, label, origin, now);
  let s = begun.state;
  calls.forEach((c, i) => {
    s = endCall(s, begun.run, i + 1, c, now);
  });
  return finishRun(s, begun.run, ms ?? 0, hash);
}

export function runLabel(address: string, chain: string, sender?: string): string {
  return `${shortAddr(address)} · ${chain}${sender ? ` · from ${shortAddr(sender)}` : ""}`;
}
