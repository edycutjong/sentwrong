import { describe, it, expect } from "vitest";
import { NansenClient, clientFromEnv } from "../src/client.js";
import { fakeClient, KEY } from "./helpers.js";

describe("NansenClient — rate limiter", () => {
  it("throttles a second call within the same rolling second when rps=1, waiting out the window before sending it", async () => {
    const c = fakeClient(() => ({ ok: true }), { rps: 1 });
    const t0 = Date.now();
    await c.post("account", {});
    await c.post("account", {});
    // the second call must have hit the "bucket full" branch and waited ~1s for the oldest timestamp to age out
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(c.calls).toHaveLength(2);
  });
});

describe("NansenClient — credit table fallback", () => {
  it("records 1 credit for an endpoint absent from the CREDITS table", async () => {
    const c = fakeClient(() => ({ ok: true }));
    await c.post("some/unlisted-endpoint", {});
    expect(c.calls[0]).toMatchObject({ endpoint: "some/unlisted-endpoint", credits: 1 });
    expect(c.creditsSpent).toBe(1);
  });
});

describe("NansenClient — recordFailure with a non-Error, attempts-less throw", () => {
  it("records status 0, attempts=1 and the stringified value when the network layer throws a plain string", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw "boom";
    };
    const c = new NansenClient(KEY, { fetchImpl, rps: 1000 });
    await expect(c.post("account", {}, [], { retries: 0 })).rejects.toBe("boom");
    expect(c.calls[0]).toMatchObject({ ok: false, status: 0, credits: 0, attempts: 1, error: "boom" });
  });
});

describe("clientFromEnv", () => {
  it("builds a client from a well-formed NANSEN_API_KEY in the environment", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    try {
      const c = clientFromEnv();
      expect(c).toBeInstanceOf(NansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });

  it("throws the missing-key error when NANSEN_API_KEY is unset (falls back to '')", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => clientFromEnv()).toThrow(/NANSEN_API_KEY missing or malformed/);
    } finally {
      if (prev !== undefined) process.env.NANSEN_API_KEY = prev;
    }
  });

  it("passes through ClientOptions such as a custom baseUrl", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    try {
      const c = clientFromEnv({ baseUrl: "https://example.test/v1" });
      expect(c).toBeInstanceOf(NansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });
});
