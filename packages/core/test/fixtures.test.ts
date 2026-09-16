import { describe, it, expect } from "vitest";
import { CachedNansenClient, sentWrong, listFixtures, readFixture, fixtureStore } from "../src/index.js";

const files = listFixtures(new URL("../../../fixtures", import.meta.url).pathname);

describe("recorded fixtures replay offline (same responses + same clock → same decision)", () => {
  it("there are at least 12 fixtures covering every route", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    const routes = new Set(files.map((f) => readFixture(f).verdict.decision.route));
    expect([...routes].sort()).toEqual(["active-stranger", "contract-or-burn", "exchange-deposit", "your-own-wallet"]);
  });
  it.each(files.map((f) => [f.split("/").pop()!, f]))("%s", async (_name, path) => {
    const f = readFixture(path);
    const client = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
    const v = await sentWrong(client, f.address, { ...f.options, now: f.now });
    expect(v.hash).toBe(f.verdict.hash);
    expect(v.decision.route).toBe(f.verdict.decision.route);
    expect(v.decision.sub).toBe(f.verdict.decision.sub);
    expect(v.decision.evidence.map((e) => e.code)).toEqual(f.verdict.decision.evidence.map((e) => e.code));
    expect(v.credits).toBe(0);
    expect(v.provenance.filter((c) => !c.cached)).toEqual([]);
  });
  it("fixtures never contain the API key or an apikey header", () => {
    for (const f of files) {
      const text = JSON.stringify(readFixture(f));
      expect(text).not.toMatch(/nsn_[a-z0-9]{20,}/i);
      expect(text).not.toMatch(/apikey/i);
    }
  });
});
