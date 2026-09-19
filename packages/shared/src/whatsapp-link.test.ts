// Tests del mensaje/enlace wa.me del comprobante.
import { describe, it, expect } from "vitest";
import { buildReceiptMessage, buildReceiptWaLink } from "./whatsapp-link";

const base = {
  phone: "0424-123-4567",
  contactName: "María",
  brandName: "Hermanos Pernía",
  raffleTitle: "El Dubai",
  numbers: ["012", "345"],
  total: 10,
};

describe("buildReceiptMessage", () => {
  it("pagado: estado PAGADO y sin línea de deuda", () => {
    const msg = buildReceiptMessage({ ...base, paid: 10 });
    expect(msg).toContain("*PAGADO* ✅");
    expect(msg).not.toContain("Te falta");
    expect(msg).toContain("— Hermanos Pernía");
  });

  it("con deuda: abonado + lo que falta", () => {
    const msg = buildReceiptMessage({ ...base, paid: 6 });
    expect(msg).toContain("Abonado: $6");
    expect(msg).toContain("*Te falta: $4*");
    expect(msg).toContain("Cuando completes el pago");
  });

  it("con status: PAGADO solo se afirma con PAID, nunca por la resta", () => {
    // Deuda 0 pero venta no confirmada como pagada → sin copy de PAGADO.
    const reserved = buildReceiptMessage({ ...base, paid: 10, status: "RESERVED" });
    expect(reserved).not.toContain("PAGADO");
    expect(reserved).toContain("Abonado: $10");

    const paidMsg = buildReceiptMessage({ ...base, paid: 10, status: "PAID" });
    expect(paidMsg).toContain("*PAGADO* ✅");
  });

  it("el preview es la IMAGEN del recibo (Cloudinary comprimido, recibo completo)", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl:
        "https://res.cloudinary.com/dbi6monrl/image/upload/v1/riffas/receipts/R-1.png",
    });
    // Transforma /upload/ a jpg comprimido a 1080 de ancho (recibo completo, sin recorte).
    expect(msg).toContain(
      "https://res.cloudinary.com/dbi6monrl/image/upload/f_jpg,q_auto:good,w_1080/v1/riffas/receipts/R-1.png"
    );
    expect(msg).toContain("🧾 Aquí tienes tu comprobante:");
  });

  it("con receiptUrl de Cloudinary + origin, el preview es la página /r (og:image), no la imagen directa", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl:
        "https://res.cloudinary.com/dbi6monrl/image/upload/v1789/riffas/receipts/R-123-ABCD.png",
      receiptPageUrl: "https://rifacil.vip/c/sale123",
    });
    // WhatsApp scrapea /rc (HTML con og:image) → miniatura fiable, también en Web.
    expect(msg).toContain("https://rifacil.vip/rc/R-123-ABCD");
    // El preview ya NO es la URL directa de la imagen.
    expect(msg).not.toContain("res.cloudinary.com");
  });

  it("la imagen va ANTES que el CTA de marca (WhatsApp previsualiza el 1er enlace)", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl: "https://res.cloudinary.com/dbi6monrl/image/upload/v1/y.png",
      brandUrl: "rifashermanospernia.com",
    });
    const iImg = msg.indexOf("res.cloudinary.com");
    const iBrand = msg.indexOf("https://rifashermanospernia.com");
    expect(iImg).toBeGreaterThan(-1);
    expect(iBrand).toBeGreaterThan(-1);
    expect(iImg).toBeLessThan(iBrand);
  });

  it("brandUrl pelado se normaliza a https:// (dominio propio del rifero)", () => {
    const msg = buildReceiptMessage({ ...base, paid: 10, brandUrl: "rifashermanospernia.com" });
    expect(msg).toContain("https://rifashermanospernia.com");
    expect(msg).toContain("Mira todas nuestras rifas");
  });

  it("sin dominio propio, el CTA cae a la página /c del comprobante", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl: "https://res.cloudinary.com/dbi6monrl/image/upload/v1/y.png",
      receiptPageUrl: "https://rifacil.vip/c/abc123",
    });
    expect(msg).toContain("https://rifacil.vip/c/abc123");
  });

  it("el dominio propio tiene prioridad sobre la página /c", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      brandUrl: "rifashermanospernia.com",
      receiptPageUrl: "https://rifacil.vip/c/abc123",
    });
    expect(msg).toContain("https://rifashermanospernia.com");
    expect(msg).not.toContain("/c/abc123");
  });

  it("omitImageLink: no repite la URL de la imagen (se adjunta como archivo) pero deja datos + marca", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl: "https://res.cloudinary.com/dbi6monrl/image/upload/v1/y.png",
      brandUrl: "rifashermanospernia.com",
      omitImageLink: true,
    });
    expect(msg).not.toContain("res.cloudinary.com");
    expect(msg).not.toContain("Aquí tienes tu comprobante");
    expect(msg).toContain("Tus números: *012, 345*");
    expect(msg).toContain("*PAGADO* ✅");
    expect(msg).toContain("https://rifashermanospernia.com");
  });

  it("sin recibo ni links, no hay bloque de comprobante", () => {
    const without = buildReceiptMessage({ ...base, paid: 10 });
    expect(without).not.toContain("Aquí tienes tu comprobante");
    expect(without).not.toContain("Mira todas nuestras rifas");
  });
});

describe("buildReceiptWaLink", () => {
  it("normaliza el teléfono venezolano a dígitos wa.me", () => {
    const link = buildReceiptWaLink({ ...base, paid: 10 });
    expect(link).toMatch(/^https:\/\/wa\.me\/584241234567\?text=/);
  });

  it("teléfono inválido → null", () => {
    expect(buildReceiptWaLink({ ...base, phone: "123" })).toBeNull();
  });
});
