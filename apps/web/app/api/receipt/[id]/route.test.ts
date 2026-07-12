// Tests del proxy same-origin del recibo (/api/receipt/[id]).
// CASE 2 (401): Skipped — endpoint público por diseño: el saleId es un cuid no
// adivinable (misma superficie que la URL de Cloudinary que ya se compartía).
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@riffas/db", () => ({
  prisma: { sale: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const CLOUDINARY_URL =
  "https://res.cloudinary.com/demo/image/upload/v1/receipts/r-001.png";

function request(id: string, qs = "") {
  return {
    req: new NextRequest(`http://localhost/api/receipt/${id}${qs}`),
    ctx: { params: { id } },
  };
}

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    receiptUrl: CLOUDINARY_URL,
    receiptNumber: "R-001",
    status: "PAID",
    ...overrides,
  };
}

function upstreamOk(contentType = "image/png") {
  return {
    ok: true,
    body: new ReadableStream(),
    headers: new Headers({ "content-type": contentType }),
  } as unknown as Response;
}

beforeEach(() => {
  findUnique.mockReset();
  vi.unstubAllGlobals();
});

describe("GET /api/receipt/[id]", () => {
  // CASE 1 (200): happy path — proxea el PNG de Cloudinary.
  it("devuelve la imagen cuando la venta tiene recibo", async () => {
    findUnique.mockResolvedValue(saleRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk()));

    const { req, ctx } = request("clxx000000000000000000000");
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  // CASE 3 (400/input inválido): un id desconocido no matchea venta → 404
  // (no hay más input que el id de la URL).
  it("404 cuando la venta no existe", async () => {
    findUnique.mockResolvedValue(null);
    const { req, ctx } = request("no-existe-xxxxxxxxxxxxxxx");
    expect((await GET(req, ctx)).status).toBe(404);
  });

  // CASE 4 (404): solo ventas confirmadas (RESERVED/PAID). Una PENDING lleva
  // montos auto-reportados por el comprador → jamás servirla como oficial.
  it.each(["PENDING", "CANCELLED", "REFUNDED"])(
    "404 cuando la venta está %s",
    async (status) => {
      findUnique.mockResolvedValue(saleRow({ status }));
      const { req, ctx } = request("clxx000000000000000000000");
      expect((await GET(req, ctx)).status).toBe(404);
    }
  );

  it("200 cuando la venta está RESERVED (apartado confirmado)", async () => {
    findUnique.mockResolvedValue(saleRow({ status: "RESERVED" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk()));
    const { req, ctx } = request("clxx000000000000000000000");
    expect((await GET(req, ctx)).status).toBe(200);
  });

  // CASE 5 (error de upstream): Cloudinary caído → 502.
  it("502 cuando Cloudinary no responde ok", async () => {
    findUnique.mockResolvedValue(saleRow());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, body: null } as unknown as Response)
    );
    const { req, ctx } = request("clxx000000000000000000000");
    expect((await GET(req, ctx)).status).toBe(502);
  });

  // Redirecciones: la validación anti-SSRF es sobre la URL inicial, así que no
  // se siguen (redirect:"error" hace que fetch lance) → 502.
  it("502 cuando el upstream redirige (no se sigue el 30x)", async () => {
    findUnique.mockResolvedValue(saleRow());
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("redirect"));
    vi.stubGlobal("fetch", fetchSpy);

    const { req, ctx } = request("clxx000000000000000000000");
    expect((await GET(req, ctx)).status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: "error" })
    );
  });

  // MIME: nunca reexponer bajo nuestro dominio un content-type no-imagen que
  // devuelva el upstream (se fuerza image/png).
  it("fuerza image/png si el upstream devuelve un MIME no permitido", async () => {
    findUnique.mockResolvedValue(saleRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk("text/html")));

    const { req, ctx } = request("clxx000000000000000000000");
    const res = await GET(req, ctx);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  // CASE 6 (anti-SSRF): solo se sigue la URL guardada si es https de Cloudinary.
  it.each([
    "http://res.cloudinary.com/demo/image/upload/x.png",
    "https://evil.example.com/upload/x.png",
    "no-es-una-url",
  ])("404 cuando receiptUrl no es Cloudinary https (%s)", async (receiptUrl) => {
    findUnique.mockResolvedValue(saleRow({ receiptUrl }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { req, ctx } = request("clxx000000000000000000000");
    expect((await GET(req, ctx)).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Extra: ?download=1 fuerza descarga con nombre legible (y con fallback si
  // la venta no tiene receiptNumber).
  it("download=1 pone Content-Disposition con el número de recibo", async () => {
    findUnique.mockResolvedValue(saleRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk()));

    const { req, ctx } = request("clxx000000000000000000000", "?download=1");
    const res = await GET(req, ctx);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="recibo-R-001.png"'
    );
  });

  it("download=1 sin receiptNumber usa un sufijo del id", async () => {
    findUnique.mockResolvedValue(saleRow({ receiptNumber: null }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk()));

    const { req, ctx } = request("clxx000000000000000000000", "?download=1");
    const res = await GET(req, ctx);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="recibo-00000000.png"'
    );
  });

  // Extra (500): si la DB explota, el error sube y Next responde 500.
  it("propaga el error cuando la base de datos falla", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const { req, ctx } = request("clxx000000000000000000000");
    await expect(GET(req, ctx)).rejects.toThrow("db down");
  });
});
