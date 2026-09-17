import { test, expect } from "@playwright/test";

/**
 * Permission boundary, HTTP edition (the unit half is packages/core/test/boundary.test.ts): nothing the browser receives —
 * page HTML, the NDJSON stream, the JSON 400, the OG image route — carries a key-shaped string. The server runs with no
 * key here, so this also proves the app has no baked-in or default key anywhere in its bundle.
 */
const KEY_SHAPE = /nsn_[A-Za-z0-9]{8,}/;
const HERO = "0xe460774c849089ee3edf0fb06da14c066caabbef";

test.describe("the key never reaches the client", () => {
  for (const path of ["/", "/judge", `/q/${HERO}`, "/q/0xnope", "/?address=" + HERO]) {
    test(`page HTML of ${path} contains no key-shaped string`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).not.toMatch(KEY_SHAPE);
      expect(html).not.toContain("apikey");
    });
  }

  test("the client JS bundles contain no key-shaped string", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/_next/static/") && r.url().endsWith(".js")) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(KEY_SHAPE);
  });

  test("API responses — 400 JSON, the NDJSON stream, the OG image — carry no key", async ({ request }) => {
    const bad = await request.post("/api/verdict", { data: { address: "garbage" } });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).not.toMatch(KEY_SHAPE);
    const stream = await request.post("/api/verdict", { data: { address: HERO } });
    expect(await stream.text()).not.toMatch(KEY_SHAPE);
    const og = await request.get(`/api/og?route=exchange-deposit&address=${HERO}&headline=test&conf=high`);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    expect((await og.body()).length).toBeGreaterThan(1000);
  });
});
