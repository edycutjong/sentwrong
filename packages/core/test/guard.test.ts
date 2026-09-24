/**
 * Spend guard on POST /api/verdict and the /q/[address] permalink (apps/web/lib/guard.ts): the server key spends real credits — and `deep` adds the
 * 100-credit labels call from a button — so past the per-IP rate the route answers 429 + Retry-After, and past the
 * day's credit ceiling an honest 503, both before `verdictFor` runs. `@/lib/engine` is mocked so no client or
 * network call is ever constructed; `parseInput` stays the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/verdict/route";
import Share, { generateMetadata } from "@/app/q/[address]/page";
import { ipAllowed, admit, creditsLeft, recordSpend, budgetExhausted, resetGuard, clientIp, IP_PER_MIN, DAILY_CREDITS, MAX_REQUEST_CREDITS, BUDGET_MESSAGE } from "@/lib/guard";

const { verdictForMock } = vi.hoisted(() => ({ verdictForMock: vi.fn() }));
// the /q page reads the request's headers through next/headers; one fixed client address here
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "192.0.2.50" }) }));
vi.mock("@/lib/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine")>();
  return { ...actual, verdictFor: verdictForMock };
});

const BODY = { address: "0x" + "a".repeat(40), chain: "ethereum" };
const post = (ip = "203.0.113.7") =>
  POST(new Request("http://localhost/api/verdict", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(BODY) }) as never);
const lastLine = async (res: Response) => JSON.parse((await res.text()).trim().split("\n").at(-1)!);

describe("guard counters", () => {
  beforeEach(resetGuard);

  it("clientIp prefers the first x-forwarded-for hop, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it(`an address gets ${IP_PER_MIN} requests a minute, then a Retry-After, then the window slides`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("a", t0 + i)).toEqual({ ok: true });
    const blocked = ipAllowed("a", t0 + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(50);
    expect(ipAllowed("b", t0 + 10_000)).toEqual({ ok: true });
    expect(ipAllowed("a", t0 + 60_001)).toEqual({ ok: true });
  });

  it("the table is bounded: 5,000 distinct addresses clear it rather than growing forever", () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("late");
    expect(ipAllowed("late").ok).toBe(false);
    for (let i = 0; i < 5_000; i++) ipAllowed(`ip-${i}`);
    expect(ipAllowed("late").ok).toBe(true);
  });

  it("the daily ceiling counts recorded spend, never refunds, keeps room for one deep request, and rolls over at UTC midnight", () => {
    const day1 = Date.parse("2026-09-20T12:00:00Z");
    expect(MAX_REQUEST_CREDITS).toBeGreaterThan(100); // a deep verdict is 100 credits of labels + the base calls
    expect(creditsLeft(day1)).toBe(DAILY_CREDITS);
    recordSpend(DAILY_CREDITS - MAX_REQUEST_CREDITS, day1);
    expect(budgetExhausted(day1)).toBe(false);
    recordSpend(1, day1);
    expect(budgetExhausted(day1)).toBe(true);
    recordSpend(-50, day1);
    expect(budgetExhausted(day1)).toBe(true);
    expect(budgetExhausted(Date.parse("2026-09-21T00:00:01Z"))).toBe(false);
  });
});

describe("POST /api/verdict under the guard", () => {
  let realKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = "nsn_guard_test_key_0000000000000000000000";
    verdictForMock.mockReset();
    verdictForMock.mockResolvedValue({ credits: 9, calls: [] });
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });

  it("a successful verdict streams as before and records its credits against the day", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect((await lastLine(res)).type).toBe("verdict");
    expect(creditsLeft()).toBe(DAILY_CREDITS - 9);
  });

  it("malformed input is still a 400 before the guard counts anything", async () => {
    const res = await POST(new Request("http://localhost/api/verdict", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ address: "nope" }) }) as never);
    expect(res.status).toBe(400);
    expect(ipAllowed("203.0.113.9").ok).toBe(true);
  });

  it("past the per-IP rate: 429 + Retry-After, verdictFor never runs; another address still gets through", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("203.0.113.7");
    const res = await post();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).message).toMatch(/try again/);
    expect(verdictForMock).not.toHaveBeenCalled();
    expect((await post("203.0.113.8")).status).toBe(200);
  });

  it("past the daily ceiling: an honest 503 naming the reset time, verdictFor never runs", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await res.json()).message).toBe(BUDGET_MESSAGE);
    expect(verdictForMock).not.toHaveBeenCalled();
  });
});

describe("admit() — the gate shared by POST /api/verdict and the /q permalink", () => {
  beforeEach(resetGuard);
  const h = (ip: string) => new Headers({ "x-forwarded-for": ip });

  it("admits, then 429s past the per-IP rate with the Retry-After in the message", () => {
    for (let i = 0; i < IP_PER_MIN; i++) expect(admit(h("198.51.100.1"))).toEqual({ ok: true });
    const r = admit(h("198.51.100.1"));
    expect(r).toMatchObject({ ok: false, status: 429 });
    if (!r.ok) expect(r.message).toMatch(new RegExp(`try again in ${r.retryAfter} s`));
  });
  it("503s with the budget message once the day cannot cover one more request", () => {
    recordSpend(DAILY_CREDITS);
    expect(admit(h("198.51.100.2"))).toEqual({ ok: false, status: 503, message: BUDGET_MESSAGE, retryAfter: 3600 });
  });
});

describe("REGRESSION (audit 2026-09-23): the /q/[address] permalink spent live credits with no guard", () => {
  let realKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = "nsn_guard_test_key_0000000000000000000000";
    verdictForMock.mockReset();
    verdictForMock.mockResolvedValue({ credits: 13, address: "0x" + "a".repeat(40), decision: { route: "retry", headline: "h", confidence: "low" } });
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });
  const props = { params: Promise.resolve({ address: "0x" + "a".repeat(40) }), searchParams: Promise.resolve({}) };

  it("every GET passes the per-IP gate and records its credits; past the rate the verdict never runs", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) await generateMetadata(props);
    expect(verdictForMock).toHaveBeenCalledTimes(IP_PER_MIN);
    expect(creditsLeft()).toBe(DAILY_CREDITS - 13 * IP_PER_MIN);
    expect(await generateMetadata(props)).toEqual({ title: "Sent Wrong" });
    expect(verdictForMock).toHaveBeenCalledTimes(IP_PER_MIN);
  });
  it("past the daily ceiling the verdict never runs", async () => {
    recordSpend(DAILY_CREDITS);
    expect(await generateMetadata(props)).toEqual({ title: "Sent Wrong" });
    expect(verdictForMock).not.toHaveBeenCalled();
  });
  // the page itself, not only its metadata: a refused permalink renders the guard's message in the banner, never a 500
  const pageProps = (el: Awaited<ReturnType<typeof Share>>) => (el.props as { children: { props: Record<string, unknown> }[] }).children[1].props;
  it("REGRESSION (a2a r01): past the daily ceiling the page renders the budget message as initialError — no throw, no verdict", async () => {
    recordSpend(DAILY_CREDITS);
    const p = pageProps(await Share(props));
    expect(p.initialError).toBe(BUDGET_MESSAGE);
    expect(p.initialVerdict).toBeUndefined();
    expect(verdictForMock).not.toHaveBeenCalled();
  });
  it("REGRESSION (a2a r01): past the per-IP rate the page renders the 429 message as initialError — no throw, no verdict", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) await generateMetadata(props);
    verdictForMock.mockClear();
    const p = pageProps(await Share(props));
    expect(p.initialError).toMatch(/^Too many requests from this address — try again in \d+ s$/);
    expect(p.initialVerdict).toBeUndefined();
    expect(verdictForMock).not.toHaveBeenCalled();
  });
});
