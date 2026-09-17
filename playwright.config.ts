import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the BUILT web app with NO Nansen key: the suites prove the surfaces a judge touches without credentials —
 * the home page, /judge, the validation path, the honest "no key" error, responsive layout, and that no key-shaped
 * string ever reaches the browser. Nothing here spends a credit.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI builds in its own step; locally build first so `next start` has something to serve
    command: process.env.CI ? "npm run start" : "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // an empty key is "not set" to the app (engine.ts) — the server must run without one for every test here
    env: { NANSEN_API_KEY: "", NANSEN_OFFLINE: "" },
  },
});
