import { describe, it, expect } from "vitest";
import {
  renderWaTemplate,
  parseWaMessageTemplates,
  serializeWaMessageTemplates,
  DEFAULT_WA_TEMPLATES,
} from "./whatsapp-message-templates";
import { buildReceiptMessage, buildReceiptWaLink } from "./whatsapp-link";

describe("renderWaTemplate", () => {
  it("sustituye variables simples", () => {
    expect(renderWaTemplate("Hola {{nombre}}", { nombre: "María" })).toBe("Hola María");
  });
  it("variable desconocida queda escrita (para notar el typo)", () => {
    expect(renderWaTemplate("Hola {{nombr}}", { nombre: "María" })).toBe("Hola {{nombr}}");
  });
  it("línea de SOLO variable vacía se omite", () => {
    expect(renderWaTemplate("A\n{{lineaVacia}}\nB", { lineaVacia: "" })).toBe("A\nB");
  });
  it("línea con variable Y texto fijo NO se omite aunque la var esté vacía", () => {
    expect(renderWaTemplate("{{saludo}}Bienvenida", { saludo: "" })).toBe("Bienvenida");
  });
  it("bloques multilínea con \\n inicial no dejan doble espacio en blanco", () => {
    expect(renderWaTemplate("A\n{{bloque}}\n\nC", { bloque: "\nB1\nB2" })).toBe("A\n\nB1\nB2\n\nC");
  });
  it("colapsa 2+ líneas en blanco y recorta bordes", () => {
    expect(renderWaTemplate("\nA\n\n\n\nB\n\n", {})).toBe("A\n\nB");
  });
});

describe("parse/serialize", () => {
  it("JSON válido → plantillas; inválido o vacío → {}", () => {
    expect(parseWaMessageTemplates('{"apartado":"A","pagado":"P"}')).toEqual({ apartado: "A", pagado: "P" });
    expect(parseWaMessageTemplates("no json")).toEqual({});
    expect(parseWaMessageTemplates(null)).toEqual({});
    expect(parseWaMessageTemplates('{"apartado":"  "}')?.apartado).toBeUndefined();
  });
  it("roundtrip; vacío → null (volver a defaults)", () => {
    const t = { apartado: "A", pagado: "P" };
    expect(parseWaMessageTemplates(serializeWaMessageTemplates(t))).toEqual(t);
    expect(serializeWaMessageTemplates({})).toBeNull();
  });
});

describe("buildReceiptMessage con plantillas", () => {
  const base = {
    phone: "04241234567",
    contactName: "María",
    brandName: "Rifas Demo",
    raffleTitle: "Moto 0km",
    numbers: ["045", "102"],
    total: 20,
    pricePerNumber: 10,
  };

  it("sin plantillas → default apartado (con deuda)", () => {
    const msg = buildReceiptMessage({ ...base, paid: 10, status: "RESERVED" });
    expect(msg).toContain("Tu apartado quedó registrado. 🍀");
    expect(msg).toContain("Números reservados: *045, 102*");
    expect(msg).toContain("💎 Deuda actual: $10");
  });

  it("sin plantillas → default pagado", () => {
    const msg = buildReceiptMessage({ ...base, paid: 20, status: "PAID" });
    expect(msg).toContain("Tu compra quedó registrada. 🎉");
    expect(msg).toContain("💎 Estado: *PAGADO* ✅");
    expect(msg).toContain("Números: *045, 102*");
  });

  it("plantilla custom de apartado se usa SOLO para apartado", () => {
    const tpl = { apartado: "EPALE {{nombre}}, apartaste *{{numeros}}* en {{rifa}}. Debes {{deuda}}. — {{marca}}" };
    const msg = buildReceiptMessage({ ...base, paid: 10, status: "RESERVED" }, tpl);
    expect(msg).toBe("EPALE María, apartaste *045, 102* en Moto 0km. Debes $10. — Rifas Demo");
    // La de pagado sigue default
    const msgPaid = buildReceiptMessage({ ...base, paid: 20, status: "PAID" }, tpl);
    expect(msgPaid).toContain("Tu compra quedó registrada. 🎉");
  });

  it("plantilla custom de pagado", () => {
    const tpl = { pagado: "¡Felicidades {{nombre}}! *{{numeros}}* es tuyo. Total {{total}}. Suerte 🍀" };
    const msg = buildReceiptMessage({ ...base, paid: 20, status: "PAID" }, tpl);
    expect(msg).toBe("¡Felicidades María! *045, 102* es tuyo. Total $20. Suerte 🍀");
  });

  it("el wa.me link lleva el texto de la plantilla custom", () => {
    const tpl = { apartado: "Apartado {{numeros}}" };
    const link = buildReceiptWaLink({ ...base, paid: 10, status: "RESERVED" }, tpl);
    expect(link).toContain(encodeURIComponent("Apartado 045, 102"));
  });

  it("defaults exportados == texto que genera el builder (punto de partida real del editor)", () => {
    // Si cambian el formato base, este test obliga a actualizar DEFAULT_WA_TEMPLATES.
    const vars = { saludo: "¡Hola X! ", resumen: "R", numeros: "N", lineaValorRifa: "V", lineaEstado: "E", lineaFechaSorteo: "F", lineaReservado: "RS", lineaCuandoCompletes: "C", bloqueVistaPrevia: "\nP", bloqueCtaRifas: "\nCTA", marca: "M" };
    expect(renderWaTemplate(DEFAULT_WA_TEMPLATES.apartado, vars)).toBe(
      "¡Hola X! Tu apartado quedó registrado. 🍀\n\nR\nNúmeros reservados: *N*\nV\nE\nF\nRS\nC\n\nP\n\nCTA\n\n🏆 Todo juega hasta tener ganador.\n— M"
    );
  });
});
