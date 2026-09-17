import { test, expect } from "@playwright/test";

const HERO = "0xe460774c849089ee3edf0fb06da14c066caabbef";

/**
 * The core flow as far as it goes with no key: input validation stops a bad address before any request, a good one
 * reaches the server and comes back with the honest "no key" error — never a fabricated verdict, never a crash.
 */
test.describe("verdict flow (no key)", () => {
  test("the submit button stays disabled until the address is a well-formed EVM address", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("The address you sent to");
    const go = page.getByRole("button", { name: "Where did it go?" });
    await expect(go).toBeDisabled();
    for (const bad of ["0x123", "vitalik.eth", "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9", HERO.slice(0, 41)]) {
      await input.fill(bad);
      await expect(go).toBeDisabled();
    }
    await input.fill(HERO);
    await expect(go).toBeEnabled();
  });

  test("POST /api/verdict rejects a malformed address with 400 and an actionable message, before any lookup", async ({ request }) => {
    const res = await request.post("/api/verdict", { data: { address: "0xnot-an-address" } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.type).toBe("error");
    expect(body.message).toMatch(/EVM address/);
    const chain = await request.post("/api/verdict", { data: { address: HERO, chain: "solana" } });
    expect(chain.status()).toBe(400);
    expect((await chain.json()).message).toMatch(/Unsupported chain/);
  });

  test("a well-formed address with no server key streams an honest error line, never a verdict", async ({ request }) => {
    const res = await request.post("/api/verdict", { data: { address: HERO } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/x-ndjson");
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === "verdict")).toBe(false);
    expect(lines.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/NANSEN_API_KEY is not set on the server/) });
  });

  test("in the UI the same error is shown in the banner; no verdict card appears", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Binance deposit address" }).click();
    await page.getByRole("button", { name: "Where did it go?" }).click();
    await expect(page.locator(".err")).toContainText("NANSEN_API_KEY is not set on the server");
    await expect(page.locator(".card")).toHaveCount(0);
  });

  test("the share page /q/<address> renders the honest error instead of a fabricated verdict", async ({ page }) => {
    const res = await page.goto(`/q/${HERO}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator(".err")).toContainText("NANSEN_API_KEY is not set on the server");
    await expect(page.locator(".card")).toHaveCount(0);
  });

  test("the share page rejects a malformed address without touching the server key", async ({ page }) => {
    await page.goto("/q/0xnope");
    await expect(page.locator(".err")).toContainText("EVM address");
  });
});
