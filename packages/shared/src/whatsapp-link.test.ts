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

  it("prefiere la página pública (/c) sobre el PNG crudo", () => {
    const msg = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl: "https://res.cloudinary.com/x/y.png",
      receiptPageUrl: "https://rifacil.app/c/abc123",
    });
    expect(msg).toContain("https://rifacil.app/c/abc123");
    expect(msg).not.toContain("res.cloudinary.com");
  });

  it("sin página pública cae al PNG; sin nada, no hay bloque de link", () => {
    const withPng = buildReceiptMessage({
      ...base,
      paid: 10,
      receiptUrl: "https://res.cloudinary.com/x/y.png",
    });
    expect(withPng).toContain("res.cloudinary.com");

    const without = buildReceiptMessage({ ...base, paid: 10 });
    expect(without).not.toContain("Mira tu comprobante");
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
