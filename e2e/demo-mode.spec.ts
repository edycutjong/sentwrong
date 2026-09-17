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
    await expect(page.getByText("Sent crypto to the wrong address?")).toBeVisible();
    await expect(page.getByLabel("The address you sent to")).toBeVisible();
    await expect(page.getByLabel("Chain")).toHaveValue("ethereum");
    await expect(page.getByRole("button", { name: "Where did it go?" })).toBeVisible();
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
    await expect(page.getByRole("link", { name: "For the judge" })).toHaveAttribute("href", "/judge");
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/edycutjong/sentwrong");
    await expect(page.locator("footer.foot")).toContainText("Never pay anyone who promises to recover funds");
  });

  test("an example button fills the input; the 'your own wallet' example reveals the sender field", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "burn address" }).click();
    await expect(page.getByLabel("The address you sent to")).toHaveValue("0x000000000000000000000000000000000000dEaD");
    await page.getByRole("button", { name: "your own wallet" }).click();
    await expect(page.getByLabel(/Your address/)).toHaveValue("0xb0aeba103a12d6034c758c37c0d9b9977e1d03b5");
  });
});
