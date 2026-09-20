import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // fast-check property suites run 10,000+ cases; 5 s is too tight on a loaded runner
    testTimeout: 60_000,
    include: ["packages/**/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**", "apps/web/lib/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
  resolve: {
    alias: {
      "@sentwrong/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      // guard.test.ts drives the web route handler directly (apps/web uses `@/` for its own root)
      "@": new URL("./apps/web", import.meta.url).pathname,
    },
  },
});
