/**
 * Spend guard for the public API route. The Nansen key is server-only and every request spends real credits, so an
 * unattended loop against the URL could drain the account. Two ceilings, no new services:
 *
 *   1. per-IP:  IP_PER_MIN requests per rolling minute → 429 with Retry-After;
 *   2. global:  DAILY_CREDITS live credits per UTC day, counted from each result's own credit total; past it the
 *      route answers an honest 503 that says why (the page shows the message instead of crashing).
 *
 * Counters live in instance memory: a ceiling, not accounting. Several instances bound the day at
 * DAILY_CREDITS × instances — still two orders of magnitude under the balance. Tunable via GUARD_IP_PER_MIN and
 * GUARD_DAILY_CREDITS.
 */
export const IP_PER_MIN = Number(process.env.GUARD_IP_PER_MIN ?? 6);
export const DAILY_CREDITS = Number(process.env.GUARD_DAILY_CREDITS ?? 3000);
/** a single request never costs more than this, so we stop when the budget can't cover one */
export const MAX_REQUEST_CREDITS = 110; // --deep adds the 100-credit labels call
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function ipAllowed(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= IP_PER_MIN) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  if (hits.size >= 5000) hits.clear(); // bound memory under a distributed scan; a cleared window only errs toward allowing
  hits.set(ip, recent);
  return { ok: true };
}

let day = "";
let spent = 0;
function roll(now: number) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    spent = 0;
  }
}
export function creditsLeft(now = Date.now()): number {
  roll(now);
  return Math.max(0, DAILY_CREDITS - spent);
}
export function recordSpend(credits: number, now = Date.now()): void {
  roll(now);
  spent += Math.max(0, credits);
}
/** true when the day's budget cannot cover one more worst-case request */
export function budgetExhausted(now = Date.now()): boolean {
  return creditsLeft(now) < MAX_REQUEST_CREDITS;
}
/** test hook */
export function resetGuard(): void {
  hits.clear();
  day = "";
  spent = 0;
}

export const RATE_MESSAGE = (s: number) => `Too many requests from this address — try again in ${s} s`;
export const BUDGET_MESSAGE = "Today's live Nansen budget for this demo is used up — come back after 00:00 UTC, or run it locally with your own key (README, under 10 minutes).";
