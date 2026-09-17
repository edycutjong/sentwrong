import { test, expect } from "@playwright/test";

/** Smoke: the app loads with no API key, no error overlay, correct metadata, no console errors. */
test.describe("home page without a key", () => {
  test("renders the hook, the input and the example addresses", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Sent Wrong/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where did it go?");
    await expect(page.getByLabel("The address you sent to")).toBeVisible();
    await expect(page.getByLabel("Chain")).toHaveValue("ethereum");
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
    for (const ex of ["Binance deposit address", "burn address", "USDC contract", "poisoning look-alike", "your own wallet"]) {
      await expect(page.getByRole("button", { name: ex })).toBeVisible();
    }
    // Next.js dev/build error overlay never appears
    await expect(page.locator("nextjs-portal")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("has the metadata a share needs and links to /judge and the repo", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Nansen labels decide/);
    await expect(page.locator("nav.site-nav").getByRole("link", { name: "For the judge" })).toHaveAttribute("href", "/judge");
    await expect(page.locator("nav.site-nav").getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/edycutjong/sentwrong");
    await expect(page.locator("footer.site-footer")).toContainText("Never pay anyone who promises to recover funds");
  });

  test("an example chip fills the input and runs; the 'your own wallet' example reveals the sender field", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "burn address" }).click();
    await expect(page.getByLabel("The address you sent to")).toHaveValue("0x000000000000000000000000000000000000dEaD");
    await page.getByRole("button", { name: "your own wallet" }).click();
    await expect(page.getByLabel(/Your address/)).toHaveValue("0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5");
  });

  test("the idle page shows the recorded example from the hero fixture, labelled, and its answer card is green", async ({ page }) => {
    await page.goto("/");
    const example = page.getByRole("region", { name: /example/i });
    await expect(example).toContainText("recorded 2026-09-16");
    await expect(example).toContainText("0 credits");
    await expect(example).toContainText("3ea6cfcd752b");
    await expect(example.locator(".card.winner")).toContainText("Binance deposit address");
    await expect(example.locator(".card").filter({ hasText: "Burn address" }).locator(".badge.impostor")).toHaveText("unrecoverable");
    await expect(page.getByRole("button", { name: "Run it live now" })).toBeVisible();
    await expect(page.locator("footer.site-footer .foot-row a").first()).toHaveText(/^v\d+\.\d+\.\d+$/);
  });

  test("'Run it live now' replaces the example with the live run (no key here → the honest error, never a fabricated card)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run it live now" }).click();
    await expect(page.locator(".banner.err")).toContainText("NANSEN_API_KEY is not set on the server");
    await expect(page.getByRole("region", { name: /example/i })).toHaveCount(0);
    await expect(page.locator(".card")).toHaveCount(0);
    await expect(page.getByLabel("The address you sent to")).toHaveValue("0xe460774c849089ee3edf0fb06da14c066caabbef");
  });
});
