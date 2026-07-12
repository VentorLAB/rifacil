// E2E de la página pública del comprobante (/c/[id]).
// Necesita una app corriendo y una venta real con recibo:
//   E2E_BASE_URL=http://localhost:3000 E2E_SALE_ID=<saleId> pnpm --filter web test:e2e
// Sin esas vars el spec se salta (no hay DB de test seedada todavía).
import { test, expect } from "@playwright/test";

const SALE_ID = process.env.E2E_SALE_ID;

test.describe("/c/[id] — comprobante público", () => {
  test.skip(!SALE_ID, "Define E2E_SALE_ID (venta con recibo) para correr este spec");

  test("muestra el recibo con marca, estado y acciones", async ({ page }) => {
    await page.goto(`/c/${SALE_ID}`);

    // La imagen del recibo es la protagonista.
    await expect(page.locator('img[alt^="Comprobante"]')).toBeVisible();
    // Estado: pagado o apartado, siempre uno de los dos.
    await expect(
      page.getByText(/PAGADO|Apartado · te falta/).first()
    ).toBeVisible();
    // Acción principal: guardar el recibo (proxy same-origin con descarga).
    const download = page.getByRole("link", { name: /Guardar mi recibo/ });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute("href", /\/api\/receipt\/.+\?download=1/);
    // Sello de confianza.
    await expect(page.getByText("Emitido con Rifácil")).toBeVisible();
  });

  test("los OG tags del preview de WhatsApp están presentes", async ({ page }) => {
    await page.goto(`/c/${SALE_ID}`);
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute("content", /c_fill,g_north,w_1080,h_1080/);
  });

  test("venta inexistente responde 404", async ({ page }) => {
    const res = await page.goto(`/c/clxxinventado0000000000000`);
    expect(res?.status()).toBe(404);
  });
});
