import { test, expect } from "@playwright/test";

const CLAIM = "Sent crypto to the wrong address? Paste it. Nansen tells you which of four recovery routes you're on — and drafts the ticket.";

/** /judge must be reachable by a stranger: no credentials, no session, no redirect, and it must say the claim. */
test.describe("/judge", () => {
  test("returns 200 with no credentials and no cookies, sets none, and does not redirect", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    const res = await page.goto("/judge");
    expect(res?.status()).toBe(200);
    expect(res?.request().redirectedFrom()).toBeNull();
    expect(new URL(page.url()).pathname).toBe("/judge");
    expect(res?.headers()["set-cookie"]).toBeUndefined();
    expect(await ctx.cookies()).toEqual([]);
    await ctx.close();
  });

  test("carries the claim sentence, the 30-second path, receipts, the reproduce command, limitations and links", async ({ page }) => {
    await page.goto("/judge");
    await expect(page.locator(".claim")).toHaveText(CLAIM);
    await expect(page.getByRole("heading", { name: /30-second path/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Receipts/ })).toBeVisible();
    await expect(page.locator("table.receipt")).toContainText("13 credits");
    await expect(page.locator("table.receipt")).toContainText("40,000");
    await expect(page.locator("pre.cmd")).toContainText("npm run sentwrong -- 0xe460774c849089ee3edf0fb06da14c066caabbef --explain");
    // the deterministic replay is labelled as such and kept out of the reproduce command
    await expect(page.locator("pre.cmd")).not.toContainText("NANSEN_OFFLINE");
    await expect(page.getByText("CI / deterministic replay (not the product):")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Honest limitations/ })).toBeVisible();
    const links = page.locator(".judge a");
    expect(await links.count()).toBeGreaterThanOrEqual(8);
    await expect(links.filter({ hasText: /^https:\/\/sentwrong\.edycu\.dev$/ }).first()).toHaveAttribute("href", "https://sentwrong.edycu.dev");
  });

  test("the raw HTML is served without a script-gated body (curl-able)", async ({ request }) => {
    const res = await request.get("/judge");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("and drafts the ticket.");
    expect(html).toContain("npm run sentwrong");
  });
});
