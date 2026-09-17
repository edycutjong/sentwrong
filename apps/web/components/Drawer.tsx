"use client";
import type { Call } from "@sentwrong/core";

export function Drawer({
  calls,
  skipped,
  open,
  onClose,
  credits,
  ms,
  asOf,
  hash,
}: {
  calls: Call[];
  skipped: string[];
  open: boolean;
  onClose: () => void;
  credits: number;
  ms: number;
  asOf?: string | null;
  hash?: string;
}) {
  const cached = calls.filter((c) => c.cached).length;
  return (
    <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <h3>
        Every Nansen call behind this verdict{" "}
        <button className="btn" onClick={onClose} tabIndex={open ? 0 : -1}>
          close
        </button>
      </h3>
      <table>
        <thead>
          <tr>
            <th>endpoint</th>
            <th>chain</th>
            <th>credits</th>
            <th>ms</th>
            <th>cached</th>
            <th>fields used</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} className={c.ok || c.status === 422 ? "" : "fail"}>
              <td className="mono">
                {c.endpoint}
                {c.attempts > 1 ? ` (×${c.attempts})` : ""}
              </td>
              <td className="mono">{String(c.body.chain ?? "—")}</td>
              <td>{c.credits}</td>
              <td>{c.ok ? c.ms : `${c.totalMs} · ${c.error}`}</td>
              <td>{c.cached ? "yes" : "live"}</td>
              <td className="mono">{c.fieldsUsed.join(", ")}</td>
            </tr>
          ))}
          {skipped.map((s) => (
            <tr key={s}>
              <td className="mono" colSpan={6}>
                skipped: {s}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sum">
        {credits} credits · {calls.length} calls ({cached} cached{asOf ? `, as of ${asOf.slice(11, 16)} UTC` : ""}) · {(ms / 1000).toFixed(1)} s{hash ? ` · verdict ${hash.slice(0, 12)}` : ""}
      </p>
    </aside>
  );
}
