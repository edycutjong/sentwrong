import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureName, writeFixture, readFixture, listFixtures, fixtureStore, type Fixture } from "../src/fixtures.js";
import { R, SENDER } from "./helpers.js";

/** Minimal-but-typed Fixture: writeFixture/readFixture only care about JSON round-tripping, not verdict semantics. */
function makeFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    edge: "test-edge",
    address: R,
    options: { chain: "ethereum" },
    now: 1_726_000_000_000,
    recordedAt: "2026-09-16T13:53:11.000Z",
    live: { calls: 3, credits: 30, ms: 421 },
    responses: {
      abc123: { storedAt: "2026-09-16T13:53:11.000Z", ttlMs: 0, endpoint: "search/general", body: {}, text: "{}" },
    },
    verdict: { hash: "deadbeef", decision: { route: "your-own-wallet", sub: "n/a", evidence: [] }, credits: 0, provenance: [] } as unknown as Fixture["verdict"],
    ...over,
  };
}

describe("fixtureName()", () => {
  it("lowercases the address and has no suffix when there is no sender", () => {
    expect(fixtureName("0xABCDEF")).toBe("0xabcdef");
  });
  it("appends a lowercased, 10-char-sliced --from-<sender> suffix when a sender is given", () => {
    // SENDER is 42 chars; slice(0, 10) keeps only the first 10 characters of the lowercased sender.
    expect(fixtureName(R, SENDER)).toBe(`${R.toLowerCase()}--from-${SENDER.toLowerCase().slice(0, 10)}`);
  });
  it("treats an empty-string sender the same as no sender (falsy branch)", () => {
    expect(fixtureName(R, "")).toBe(R.toLowerCase());
  });
});

describe("writeFixture() / readFixture() round trip", () => {
  let dir: string;
  afterEach(() => { if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it("creates the directory (recursive), names the file from address+sender, and writes readable JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "sentwrong-fixtures-"));
    const nested = join(dir, "nested", "deeper"); // exercises mkdirSync's recursive:true
    const f = makeFixture({ options: { chain: "ethereum", sender: SENDER } });
    const path = writeFixture(f, nested);
    expect(path).toBe(join(nested, `${fixtureName(f.address, SENDER)}.json`));
    expect(existsSync(path)).toBe(true);
    const back = readFixture(path);
    expect(back).toEqual(f);
  });

  it("falls back to FIXTURES_DIR when dir is omitted (default-parameter branch), never touching the real fixtures/ tree", () => {
    // Exercise `dir = FIXTURES_DIR` for real, but with cwd swapped to a temp dir first, so the relative
    // "fixtures" the default resolves to is a throwaway directory, never the repo's real fixtures/.
    dir = mkdtempSync(join(tmpdir(), "sentwrong-fixtures-"));
    const cwdBefore = process.cwd();
    process.chdir(dir);
    try {
      const f = makeFixture();
      const path = writeFixture(f); // dir omitted -> default FIXTURES_DIR ("fixtures"), relative to the swapped cwd
      expect(path).toBe(join("fixtures", `${fixtureName(f.address, f.options.sender)}.json`));
      expect(existsSync(join(dir, "fixtures", `${fixtureName(f.address, f.options.sender)}.json`))).toBe(true);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("round-trips a fixture with no sender in options", () => {
    dir = mkdtempSync(join(tmpdir(), "sentwrong-fixtures-"));
    const f = makeFixture({ options: { chain: "ethereum" } });
    const path = writeFixture(f, dir);
    expect(readFixture(path)).toEqual(f);
  });
});

describe("listFixtures()", () => {
  let dir: string;
  afterEach(() => { if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it("returns [] when the directory does not exist (catch branch)", () => {
    expect(listFixtures(join(tmpdir(), "sentwrong-does-not-exist-" + Math.random().toString(36).slice(2)))).toEqual([]);
  });

  it("lists only .json files, sorted, as full paths, ignoring non-.json siblings", () => {
    dir = mkdtempSync(join(tmpdir(), "sentwrong-fixtures-"));
    writeFixture(makeFixture({ address: "0xbbbb" }), dir);
    writeFixture(makeFixture({ address: "0xaaaa" }), dir);
    writeFileSync(join(dir, "notes.txt"), "not a fixture");
    const files = listFixtures(dir);
    expect(files).toEqual([join(dir, "0xaaaa.json"), join(dir, "0xbbbb.json")]);
  });
});

describe("fixtureStore()", () => {
  it("pre-loads a MemoryCache with every response entry, keyed exactly as recorded", () => {
    const f = makeFixture({
      responses: {
        keyA: { storedAt: "2026-09-16T00:00:00.000Z", ttlMs: 0, endpoint: "search/general", body: {}, text: '{"a":1}' },
        keyB: { storedAt: "2026-09-16T00:00:01.000Z", ttlMs: 0, endpoint: "profiler/address/transactions", body: { x: 1 }, text: '{"b":2}', status: 422 },
      },
    });
    const store = fixtureStore(f);
    expect(store.get("keyA")).toEqual(f.responses.keyA);
    expect(store.get("keyB")).toEqual(f.responses.keyB);
    expect(store.get("missing")).toBeUndefined();
  });

  it("loads an empty store for a fixture with no responses", () => {
    const store = fixtureStore(makeFixture({ responses: {} }));
    expect(store.entries()).toEqual({});
  });
});
