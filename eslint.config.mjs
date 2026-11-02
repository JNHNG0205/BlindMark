import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/.next/", "**/next-env.d.ts", "target/"]),
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**"],
    extends: [nextCoreWebVitals],
    settings: { next: { rootDir: "apps/web" } },
  },
]);
