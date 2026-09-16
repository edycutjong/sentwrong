import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@sentwrong/core"],
  // the engine is TypeScript source in the workspace; Next compiles it with the app
  experimental: { externalDir: true },
};
export default config;
