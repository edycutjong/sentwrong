import { test, expect } from "@playwright/test";

/** Layout at phone / tablet / desktop widths: no horizontal scroll, header fits, the primary button is a real touch target. */
const SIZES = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const s of SIZES) {
  test(`${s.name} (${s.width}px): no horizontal overflow on / and /judge, primary button ≥ 36px, header fits`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    for (const path of ["/", "/judge"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(overflow.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(overflow.inner);
      const header = await page.locator("header.top").boundingBox();
      expect(header?.width).toBeLessThanOrEqual(s.width);
    }
    await page.goto("/");
    const btn = await page.getByRole("button", { name: "Where did it go?" }).boundingBox();
    expect(btn?.height).toBeGreaterThanOrEqual(36);
    const input = await page.getByLabel("The address you sent to").boundingBox();
    expect(input?.height).toBeGreaterThanOrEqual(36);
  });
}
