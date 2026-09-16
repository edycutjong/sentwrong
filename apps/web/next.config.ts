import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@sentwrong/core"],
  // the engine is TypeScript source in the workspace, written with ESM ".js" specifiers; Next compiles it with the app
  experimental: { externalDir: true },
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return cfg;
  },
  turbopack: { resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"] },
};
export default config;
