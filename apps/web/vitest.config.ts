// Unit tests de la app web (vitest). Solo *.test.{ts,tsx}: los *.spec.ts de
// tests/ son E2E de Playwright y corren aparte (pnpm test:e2e).
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
});
