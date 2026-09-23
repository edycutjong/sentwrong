import { describe, it, expect } from "vitest";
import { NansenClient } from "../src/client.js";
import { fakeClient } from "./helpers.js";

describe("NansenClient", () => {
  it("rejects a missing or malformed key", () => {
    expect(() => new NansenClient("")).toThrow(/NANSEN_API_KEY/);
    expect(() => new NansenClient("abc")).toThrow(/nsn_/);
  });
  it("sends the apikey header and records credits, status and a sha256 of the raw body", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_u, init) => { headers = init!.headers as Record<string, string>; return new Response('{"data":[]}', { status: 200 }); };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl });
    await c.post("profiler/address/counterparties", { chain: "ethereum", token_address: "0x1" }, ["data[].address_label"]);
    expect(headers.apikey).toMatch(/^nsn_/);
    expect(c.calls[0]).toMatchObject({ endpoint: "profiler/address/counterparties", credits: 5, status: 200, cached: false, fieldsUsed: ["data[].address_label"] });
    expect(c.calls[0].responseHash).toHaveLength(64);
    expect(c.creditsSpent).toBe(5);
  });
  it("retries once on 429 then succeeds; the failed attempt is not recorded", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("slow down", { status: 429 }) : { ok: true }));
    const out = await c.post("profiler/address/transactions", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(1);
  });
  it("throws NansenError with status on 4xx without retry", async () => {
    let n = 0;
    const c = fakeClient(() => { n++; return new Response('{"error":"Missing field"}', { status: 422 }); });
    await expect(c.post("profiler/address/first-funder", {})).rejects.toThrow(/HTTP 422/);
    expect(n).toBe(1);
    // the failure is recorded in provenance at 0 credits, with the real attempt count
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 422, credits: 0, attempts: 1 });
    expect(c.calls[0].error).toMatch(/HTTP 422/);
  });
  it("gives up after the second 5xx and records attempts=2", async () => {
    const c = fakeClient(() => new Response("boom", { status: 503 }));
    await expect(c.post("profiler/address/counterparties", {})).rejects.toThrow(/HTTP 503/);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 503, attempts: 2 });
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
  });
});

describe("review fix: retried attempts are visible in provenance", () => {
  it("REGRESSION (provenance): a retried call showed one attempt and the last attempt's ms — attempts=2 and totalMs ≥ the backoff are recorded", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("x", { status: 503 }) : { ok: 1 }));
    await c.post("profiler/address/counterparties", {});
    expect(c.calls[0].attempts).toBe(2);
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
    expect(c.calls[0].ms).toBeLessThan(700);
  });
  it("REGRESSION (provenance): a first-attempt timeout was not retried — it is retried and counted as attempts=2", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_u, init) => {
      if (n++ === 0) await new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return new Response('{"ok":1}', { status: 200 });
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 30, rps: 1000 });
    await c.post("profiler/address/counterparties", {});
    expect(c.calls[0].attempts).toBe(2);
  });
});

describe("per-call options", () => {
  it("retries: 0 fails fast on a 5xx with attempts=1", async () => {
    let n = 0;
    const c = fakeClient(() => { n++; return new Response("x", { status: 503 }); });
    await expect(c.post("profiler/address/first-funder", {}, [], { retries: 0 })).rejects.toThrow(/503/);
    expect(n).toBe(1);
    expect(c.calls[0].attempts).toBe(1);
  });
  it("a per-call timeoutMs overrides the client default", async () => {
    const fetchImpl: typeof fetch = async (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 60_000, rps: 1000 });
    const t0 = Date.now();
    await expect(c.post("profiler/address/first-funder", {}, [], { timeoutMs: 20, retries: 0 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(c.calls[0]).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
  });
});

describe("audit 2026-09-23: transient failures", () => {
  it("REGRESSION (dropped connection): a fetch TypeError ('fetch failed') was not retried like a timeout — it is retried once", async () => {
    let n = 0;
    const c = fakeClient(() => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return { ok: true };
    });
    expect(await c.post("profiler/address/transactions", {})).toEqual({ ok: true });
    expect(c.calls[0]).toMatchObject({ ok: true, attempts: 2 });
  });
  it("a second dropped connection gives up with attempts=2; a plain Error is not retried", async () => {
    const c = fakeClient(() => { throw new TypeError("fetch failed"); });
    await expect(c.post("profiler/address/transactions", {})).rejects.toThrow(/fetch failed/);
    expect(c.calls[0]).toMatchObject({ ok: false, attempts: 2 });
    let n = 0;
    const d = fakeClient(() => { n++; throw new Error("boom"); });
    await expect(d.post("profiler/address/transactions", {})).rejects.toThrow(/boom/);
    expect(n).toBe(1);
  });
  it("a 429 with Retry-After waits that long (capped at 3 s) before the retry", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) : { ok: true }));
    const t0 = Date.now();
    await c.post("profiler/address/transactions", {});
    expect(Date.now() - t0).toBeGreaterThanOrEqual(990);
    expect(c.calls[0].attempts).toBe(2);
  });
  it("a non-JSON 200 on the plain client is one failed row, not an ok row followed by a failed one", async () => {
    const c = fakeClient(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(c.post("profiler/address/transactions", {})).rejects.toThrow(/non-JSON response/);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].ok).toBe(false);
  });
});
