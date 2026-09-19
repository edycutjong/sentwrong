// ESLint flat config — TypeScript everywhere, React hooks rules in apps/web. `npm run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/", "**/.next/", "coverage/", "playwright-report/", "test-results/", ".lighthouseci/", "fixtures/", "apps/web/next-env.d.ts", "apps/web/.cache/", ".cache/", ".vercel/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.es2022 } },
    rules: {
      // the engine models "unused" deliberately in a few destructurings; underscore-prefixed names are the convention
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_|^e$" }],
      // Nansen responses are typed in nansen.ts; a handful of boundary casts stay explicit
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
