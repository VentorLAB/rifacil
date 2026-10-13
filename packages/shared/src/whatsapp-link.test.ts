// Tests del mensaje/enlace wa.me del comprobante (formato riffas.info).
import { describe, it, expect } from "vitest";
import { buildReceiptMessage, buildReceiptWaLink, formatVeDate } from "./whatsapp-link";

const base = {
  phone: "0424-123-4567",
  contactName: "María",
  brandName: "Hermanos Pernía",
  raffleTitle: "El Dubai",
  numbers: ["012", "345"],
  total: 10,
};

describe("buildReceiptMessage", () => {
  it("compra pagada: texto de COMPRA (no de apartado), estado PAGADO y sin deuda", () => {
    const msg = buildReceiptMessage({ ...base, paid: 10 });
    expect(msg).toContain("Tu compra quedó registrada. 🎉");
    expect(msg).not.toContain("Tu apartado quedó");
    expect(msg).toContain(`Has completado el pago de $10\npara la rifa "El Dubai"`);
    expect(msg).toContain("Números: *012, 345*");
    expect(msg).toContain("💎 Estado: *PAGADO* ✅");
    expect(msg).not.toContain("Deuda actual");
    expect(msg).not.toContain("Cuando completes el pago");
    expect(msg).toContain("— Hermanos Pernía");
    expect(msg).toContain("🏆 Todo juega hasta tener ganador.");
  });

  it("apartado con abono: texto de apartado, abonos totales y deuda", () => {
    const msg = buildReceiptMessage({ ...base, paid: 6 });
    expect(msg).toContain("Tu apartado quedó registrado. 🍀");
    expect(msg).not.toContain("Tu compra quedó");
    expect(msg).toContain(`Has realizado abonos por un total de $6\npara la rifa "El Dubai"`);
    expect(msg).toContain("Números reservados: *012, 345*");
    expect(msg).toContain("💎 Deuda actual: $4");
    expect(msg).toContain("Cuando completes el pago confirmamos tu apartado. 🤝");
  });

  it("apartado sin abono: 'Apartaste' + deuda = total", () => {
    const msg = buildReceiptMessage({ ...base, paid: 0, status: "RESERVED" });
    expect(msg).toContain("Apartaste tus números por $10");
    expect(msg).toContain("💎 Deuda actual: $10");
    expect(msg).not.toContain("abonos por un total");
  });

  it("con status: PAGADO solo se afirma con PAID, nunca por la resta", () => {
    // Deuda 0 pero venta no confirmada como pagada → sin copy de PAGADO.
    const reserved = buildReceiptMessage({ ...base, paid: 10, status: "RESERVED" });
    expect(reserved).not.toContain("PAGADO");
    expect(reserved).toContain("💎 Abonado: $10");

    const paidMsg = buildReceiptMessage({ ...base, paid: 10, status: "PAID" });
    expect(paidMsg).toContain("*PAGADO* ✅");
  });

  it("Valor de la rifa = precio EFECTIVO de la venta (total ÷ números), no el precio actual de la rifa", () => {
    // Rifa HOY a $13, pero la venta fue 2 números por $24 (precio viejo/pack $12):
    // el mensaje debe mostrar $12 para que los montos cuadren (2 × $12 = $24).
    const old_sale = buildReceiptMessage({ ...base, total: 24, paid: 0, status: "RESERVED", pricePerNumber: 13 });
    expect(old_sale).toContain("💎 Valor de la rifa: $12");
    expect(old_sale).not.toContain("$13");
    // Sin pricePerNumber también sale: se deriva del total y los números.
    const derived = buildReceiptMessage({ ...base, paid: 10 });
    expect(derived).toContain("💎 Valor de la rifa: $5");
    // Respaldo: sin total/números se usa el pricePerNumber dado.
    const fallback = buildReceiptMessage({ ...base, numbers: [], total: 0, paid: 0, status: "RESERVED", pricePerNumber: 7 });
    expect(fallback).toContain("💎 Valor de la rifa: $7");
  });

  it("fechas del sorteo y del apartado, en hora de Venezuela", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      drawDate: "2026-10-04T02:10:00Z", // 3 oct 2026, 22:10 VET
      reservedAt: new Date("2026-09-05T18:54:00Z"), // 5 sept 2026, 14:54 VET
    });
    expect(msg).toContain("💎 Fecha del sorteo: 3 oct 2026, 22:10");
    expect(msg).toContain("💎 Reservado: 5 sept 2026, 14:54");
  });

  it("sin fechas, las líneas no salen", () => {
    const msg = buildReceiptMessage({ ...base, paid: 10 });
    expect(msg).not.toContain("Fecha del sorteo");
    expect(msg).not.toContain("Reservado:");
  });

  it("sin saludo si no hay nombre de cliente", () => {
    const msg = buildReceiptMessage({ ...base, contactName: null, paid: 10 });
    expect(msg).not.toContain("¡Hola");
    expect(msg).toContain("Tu compra quedó registrada.");
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
    expect(msg).toContain("💎 Vista previa del recibo:");
  });

  it("con receiptUrl de Cloudinary + origin, el preview es la página /rc (og:image), no la imagen directa", () => {
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

  it("receiptShareUrl (ImgBB/ibb.co) es el preview PREFERIDO sobre /rc y la imagen directa (prioridad 1, como riffas.info)", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptShareUrl: "https://ibb.co/7J6hKQP8",
      receiptUrl:
        "https://res.cloudinary.com/dbi6monrl/image/upload/v1789/riffas/receipts/R-123-ABCD.png",
      receiptPageUrl: "https://rifacil.vip/c/sale123",
    });
    // Gana ImgBB: WhatsApp pinta su card GRANDE y legible dentro del chat.
    expect(msg).toContain("💎 Vista previa del recibo:\nhttps://ibb.co/7J6hKQP8");
    // Y NO usa /rc ni la imagen directa cuando hay link de ImgBB.
    expect(msg).not.toContain("/rc/");
    expect(msg).not.toContain("res.cloudinary.com");
  });

  it("sin receiptShareUrl, cae a /rc (respaldo)", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptShareUrl: null,
      receiptUrl:
        "https://res.cloudinary.com/dbi6monrl/image/upload/v1789/riffas/receipts/R-123-ABCD.png",
      receiptPageUrl: "https://rifacil.vip/c/sale123",
    });
    expect(msg).toContain("https://rifacil.vip/rc/R-123-ABCD");
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
    expect(msg).not.toContain("Vista previa del recibo");
    expect(msg).toContain("Números: *012, 345*");
    expect(msg).toContain("*PAGADO* ✅");
    expect(msg).toContain("https://rifashermanospernia.com");
  });

  it("sin recibo ni links, no hay bloque de comprobante", () => {
    const without = buildReceiptMessage({ ...base, paid: 10 });
    expect(without).not.toContain("Vista previa del recibo");
    expect(without).not.toContain("Mira todas nuestras rifas");
  });
});

describe("formatVeDate", () => {
  it("formatea en hora de Venezuela (UTC-4, sin DST)", () => {
    expect(formatVeDate("2026-10-04T02:10:00Z")).toBe("3 oct 2026, 22:10");
    expect(formatVeDate(new Date("2026-09-05T18:54:00Z"))).toBe("5 sept 2026, 14:54");
  });

  it("null/undefined/fecha inválida → null", () => {
    expect(formatVeDate(null)).toBeNull();
    expect(formatVeDate(undefined)).toBeNull();
    expect(formatVeDate("no-es-fecha")).toBeNull();
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
