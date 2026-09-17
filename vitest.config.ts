import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["packages/core/src/**", "apps/web/lib/**"], reporter: ["text", "lcov"], reportsDirectory: "coverage" },
  },
  resolve: { alias: { "@sentwrong/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname } },
});
