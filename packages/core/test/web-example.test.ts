/** apps/web/lib/example.ts — the trimmed view of a fixture the empty state and the call rail are seeded from. */
import { describe, it, expect } from "vitest";
import { readFixture } from "../src/fixtures.js";
import { exampleFrom } from "../../../apps/web/lib/example.js";

describe("exampleFrom()", () => {
  it("keeps the decision, the hash, the live cost and the replayed provenance — and nothing of the raw responses or the ticket text", () => {
    const f = readFixture("fixtures/0xe460774c849089ee3edf0fb06da14c066caabbef.json");
    const x = exampleFrom(f, "hero.json");
    expect(x.address).toBe(f.verdict.address);
    expect(x.hash).toBe(f.verdict.hash);
    expect(x.decision.route).toBe("exchange-deposit");
    expect(x.live).toEqual(f.live);
    expect(x.recordedAt).toBe("2026-09-16");
    expect(x.file).toBe("hero.json");
    expect(x.provenance).toBe(f.verdict.provenance);
    expect(x.provenance).toHaveLength(f.verdict.calls);
    expect(JSON.stringify(x)).not.toContain("Hello Binance support");
    expect(x).not.toHaveProperty("responses");
  });

  it("carries the sender for a --from fixture", () => {
    const f = readFixture("fixtures/0x3ff462b155011159f9afe68b0a3c509dc6f462b0--from-0xb0aeba10.json");
    expect(exampleFrom(f, "own.json").sender).toBe("0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5");
  });
});
