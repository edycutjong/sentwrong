import { test, expect } from "@playwright/test";

/**
 * The Nansen call rail (family spec §13 A3): a landmark that shows the recorded example's replayed calls on load,
 * with counters that equal the example's own totals; on a phone it docks as a bar that opens with a tap and with Enter.
 * No key here, so nothing is spent — the live path is covered against production in the recording check.
 */
test.describe("Nansen call rail", () => {
  test("is a landmark, seeded with the hero fixture's 10 replayed calls at 0 credits, oldest first", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    await expect(rail).toHaveCount(1);
    const rows = rail.locator(".rail-row");
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText("search/general");
    await expect(rows.last()).toContainText("transaction-with-token-transfer-lookup");
    for (const r of await rows.all()) {
      await expect(r).toHaveAttribute("data-status", "cached");
      await expect(r).toContainText("0 cr · replayed");
    }
    await expect(rail.locator(".rail-run-kind").first()).toContainText(/replayed/);
    await expect(rail.locator(".rail-counters")).toContainText("10");
    await expect(rail.locator(".rail-foot")).toContainText("session · 10 calls · 0 credits");
    // the param line never carries a request body or anything key-shaped
    const params = await rail.locator(".rail-params").allTextContents();
    for (const p of params) {
      expect(p).not.toMatch(/nsn_|pagination|order_by|\{/);
      expect(p.length).toBeLessThan(60);
    }
  });

  test("a run that fails before its first call still gets its header and error line; nothing is left pending", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run it live now" }).click();
    await expect(page.locator(".banner.err")).toContainText("NANSEN_API_KEY is not set on the server");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    await expect(rail.locator(".rail-run.live")).toHaveCount(1);
    await expect(rail.locator(".rail-run.live .rail-run-error")).toContainText("NANSEN_API_KEY is not set");
    await expect(rail.locator(".rail-run.live .rail-run-tail")).toHaveText("failed");
    await expect(rail.locator(".rail-row.pending")).toHaveCount(0);
    // the example's rows stay: the rail accumulates across the session
    await expect(rail.locator(".rail-row")).toHaveCount(10);
  });

  test("clear empties the session and shows the empty state", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const isSheet = (await page.viewportSize())!.width < 1280;
    if (isSheet) await rail.getByRole("button", { name: /Nansen calls/ }).click();
    await rail.getByRole("button", { name: "clear" }).click();
    await expect(rail.locator(".rail-row")).toHaveCount(0);
    await expect(rail.locator(".rail-empty")).toContainText("No calls yet");
    await expect(rail.getByRole("button", { name: "clear" })).toHaveCount(0);
  });

  test("layout: a fixed 360 px right rail at ≥ 1280 px that never overlaps the main column; a 44 px bar below", async ({ page }) => {
    const width = (await page.viewportSize())!.width;
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const box = (await rail.boundingBox())!;
    if (width >= 1280) {
      expect(Math.round(box.width)).toBe(360);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 24 + 1);
      const main = (await page.locator("main.wrap").boundingBox())!;
      expect(main.x + main.width).toBeLessThanOrEqual(box.x);
      await expect(rail.getByRole("button", { name: /Nansen calls/ })).toBeHidden();
    } else {
      const bar = rail.getByRole("button", { name: /Nansen calls/ });
      await expect(bar).toBeVisible();
      expect(Math.round((await bar.boundingBox())!.height)).toBe(44);
      await expect(bar).toHaveAttribute("aria-expanded", "false");
      // opens with a tap …
      await bar.click();
      await expect(bar).toHaveAttribute("aria-expanded", "true");
      await expect(rail.locator(".rail-row").last()).toBeInViewport();
      // … closes and reopens with Enter
      await bar.focus();
      await page.keyboard.press("Enter");
      await expect(bar).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Enter");
      await expect(bar).toHaveAttribute("aria-expanded", "true");
      const open = (await rail.boundingBox())!;
      expect(open.height).toBeLessThanOrEqual((await page.viewportSize())!.height * 0.6 + 1);
    }
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
  });

  test("/judge has no rail; the permalink page has one", async ({ page }) => {
    await page.goto("/judge");
    await expect(page.getByRole("complementary", { name: "Nansen API calls" })).toHaveCount(0);
    await page.goto("/q/0xe460774c849089ee3edf0fb06da14c066caabbef");
    await expect(page.getByRole("complementary", { name: "Nansen API calls" })).toHaveCount(1);
  });
});
