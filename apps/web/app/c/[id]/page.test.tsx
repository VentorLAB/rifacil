// Tests de la página pública del comprobante (/c/[id]): metadata OG (el preview
// que WhatsApp pinta en el chat) y el render del server component.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// react.cache identidad: fuera de un request de React no hay nada que dedupe,
// y la implementación real guarda la promesa rechazada sin handler (vitest la
// reporta como unhandled rejection en los casos de NOT_FOUND).
vi.mock("react", async (importOriginal) => {
  const m = (await importOriginal()) as Record<string, unknown>;
  return { ...m, cache: (fn: unknown) => fn };
});
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const getReceipt = vi.fn();
vi.mock("@/lib/server-trpc", () => ({
  getPublicCaller: () => ({ public: { getReceipt } }),
}));

import PublicReceiptPage, { generateMetadata } from "./page";

const RECEIPT_URL =
  "https://res.cloudinary.com/demo/image/upload/v1/receipts/r-001.png";

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "clxx000000000000000000000",
    receiptUrl: RECEIPT_URL,
    receiptNumber: "R-001",
    numbers: ["012", "345"],
    total: 10,
    paid: 10,
    debt: 0,
    status: "PAID",
    buyerName: "María P.",
    raffle: {
      id: "raffle-1",
      title: "El Dubai",
      isPublic: true,
      drawDate: new Date("2026-08-01T00:00:00Z"),
    },
    brand: { name: "Hermanos Pernía", logo: null, color: "#f5c518" },
    ...overrides,
  };
}

// Con llaves: si la arrow DEVUELVE el mock (mockReset retorna this), vitest lo
// trataría como callback de limpieza y lo llamaría tras cada test.
beforeEach(() => {
  getReceipt.mockReset();
});

describe("generateMetadata", () => {
  it("arma título, descripción y og:image cuadrada desde el recibo", async () => {
    getReceipt.mockResolvedValue(receipt());
    const meta = await generateMetadata({ params: { id: "x".repeat(25) } });

    expect(meta.title).toContain("Hermanos Pernía");
    expect(meta.description).toContain("El Dubai");
    expect(meta.description).toContain("PAGADO");
    const img = (meta.openGraph?.images as { url: string }[])[0];
    expect(img.url).toContain("c_fill,g_north,w_1080,h_1080");
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("acota la lista de números en la descripción (ventas grandes)", async () => {
    const numbers = Array.from({ length: 20 }, (_, i) => String(i).padStart(3, "0"));
    getReceipt.mockResolvedValue(
      receipt({ numbers, status: "RESERVED", debt: 5, paid: 5 })
    );
    const meta = await generateMetadata({ params: { id: "x".repeat(25) } });

    expect(meta.description).toContain("y 14 más");
    expect(meta.description).toContain("Abonado $5 de $10");
  });

  it("venta inexistente → metadata de no encontrado", async () => {
    // throw lazy (no mockRejectedValue): la promesa rechazada anticipada
    // dispara el detector de unhandled rejection de vitest.
    getReceipt.mockImplementation(async () => {
      throw new Error("NOT_FOUND");
    });
    const meta = await generateMetadata({ params: { id: "x".repeat(25) } });
    expect(meta.title).toBe("Comprobante no encontrado");
  });
});

describe("PublicReceiptPage", () => {
  async function render(id = "x".repeat(25)) {
    return renderToStaticMarkup(await PublicReceiptPage({ params: { id } }));
  }

  it("venta inexistente → notFound()", async () => {
    getReceipt.mockImplementation(async () => {
      throw new Error("NOT_FOUND");
    });
    await expect(render()).rejects.toBe(NOT_FOUND);
  });

  it("pagado: badge PAGADO, recibo, botón de descarga y upsell", async () => {
    getReceipt.mockResolvedValue(receipt());
    const html = await render();

    expect(html).toContain("PAGADO");
    expect(html).toContain(RECEIPT_URL);
    expect(html).toContain("/api/receipt/clxx000000000000000000000?download=1");
    expect(html).toContain("/r/raffle-1"); // rifa pública y activa → upsell
    expect(html).toContain("Sorteo:");
    expect(html).toContain("María P.");
  });

  it("con deuda: badge de apartado con lo que falta", async () => {
    getReceipt.mockResolvedValue(receipt({ status: "RESERVED", debt: 4, paid: 6 }));
    const html = await render();
    expect(html).toContain("te falta");
    expect(html).toContain("$4");
  });

  it("PAGADO lo decide el status, no la resta de montos", async () => {
    // Deuda 0 pero venta aún no marcada PAID por el rifero → jamás "PAGADO".
    getReceipt.mockResolvedValue(receipt({ status: "RESERVED", debt: 0, paid: 10 }));
    const html = await render();
    expect(html).not.toContain("PAGADO");
    expect(html).toContain("Apartado");
  });

  it("rifa no pública: sin link de upsell", async () => {
    getReceipt.mockResolvedValue(
      receipt({ raffle: { id: "raffle-1", title: "El Dubai", isPublic: false, drawDate: null } })
    );
    const html = await render();
    expect(html).not.toContain("/r/raffle-1");
    expect(html).not.toContain("Sorteo:");
  });

  it("marca oscura: el botón usa texto blanco (contraste)", async () => {
    getReceipt.mockResolvedValue(
      receipt({ brand: { name: "X", logo: null, color: "#1e293b" } })
    );
    const html = await render();
    expect(html).toContain("color:#fff");
  });

  it("marca clara: el botón usa texto negro", async () => {
    getReceipt.mockResolvedValue(receipt());
    const html = await render();
    expect(html).toContain("color:#000");
  });
});
