import { describe, it, expect } from "vitest";
import { GET } from "./route";

// Route handler puro (edge): construye una página HTML con og:image a partir del
// receiptNumber. No toca la base de datos, así que se prueba directo.
const call = (id: string) => GET({} as any, { params: { id } });

describe("/rc/[id] — página preview del comprobante (og:image)", () => {
  it("200: HTML con og:image apuntando al recibo de Cloudinary", async () => {
    const res = await call("R-123-ABCD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('property="og:image"');
    expect(html).toContain("/riffas/receipts/R-123-ABCD.png");
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    // Cacheable en el edge para que el crawler responda al instante.
    expect(res.headers.get("cache-control") || "").toContain("s-maxage");
  });

  it("acepta el sufijo .png sin duplicarlo", async () => {
    const res = await call("R-123-ABCD.png");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/riffas/receipts/R-123-ABCD.png");
    expect(html).not.toContain(".png.png");
  });

  it("404 con id inválido (path traversal / caracteres no permitidos)", async () => {
    expect((await call("../../etc/passwd")).status).toBe(404);
    expect((await call("a b")).status).toBe(404);
  });

  it("404 con id vacío", async () => {
    expect((await call("")).status).toBe(404);
  });
});
