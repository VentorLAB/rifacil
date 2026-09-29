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
    // BLINDAJE del fix ImgBB: el og:image DEBE ser un PNG real (sin f_jpg) para que
    // la URL .png coincida con el content-type image/png y WhatsApp pinte la card
    // GRANDE. Fijamos el transform EXACTO: si alguien re-mete f_jpg, el "/" pegado a
    // q_auto:good se rompe (quedaría "q_auto:good,f_jpg/") y este assert falla.
    // PNG RGB (sin q_auto → no paleta) para que WhatsApp pinte la card grande.
    expect(html).toContain(
      "c_pad,w_1080,h_790,b_rgb:e6e7eb/riffas/receipts/R-123-ABCD.png"
    );
    // El og:image NO debe llevar q_auto (paleta) ni f_jpg.
    expect(html).not.toContain("q_auto:good/riffas/receipts/R-123-ABCD.png");
    expect(html).toContain('property="og:image:type" content="image/png"');
    // La imagen `full` (la que ve una persona al tocar el link) SÍ es JPEG a
    // propósito — otro flujo, no el og:image. La protegemos para no confundirlas.
    expect(html).toContain("f_jpg,q_auto:good,w_1200/riffas/receipts/R-123-ABCD.png");
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
