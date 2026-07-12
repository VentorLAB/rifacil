// E2E (Playwright). Corre aparte de vitest: pnpm test:e2e.
// Requiere un servidor levantado y datos reales/seed:
//   E2E_BASE_URL=http://localhost:3000 E2E_SALE_ID=<saleId con recibo> pnpm test:e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
  },
});
