import { describe, expect, it } from "vitest";
import { countPhones, testSignals, vetTime, type SaleForSignals, type SignalContext } from "./test-signals";

const base: SaleForSignals = {
  receiptNumber: "R-1",
  contactName: "Ana Pérez",
  contactPhone: "+584241234567",
  createdAt: new Date("2026-10-10T18:30:00Z"), // 14:30 VET
  amountPaid: 55,
};
const ctx = (over: Partial<SignalContext> = {}): SignalContext => ({
  pricePerNumber: 55,
  businessPhones: new Set(["+584247376999"]),
  phoneSaleCount: new Map(),
  ...over,
});

describe("testSignals", () => {
  it("a normal afternoon sale at list price has no signals", () => {
    expect(testSignals(base, ctx())).toEqual([]);
  });

  it("flags the owner's name (the 11-oct receipt test was Marco Vera, $55, 20:11 VET)", () => {
    const s = { ...base, contactName: "Marco Vera", createdAt: new Date("2026-10-12T00:11:26Z") };
    expect(testSignals(s, ctx())).toEqual(["nombre Marco Vera"]);
  });

  it("flags test-like names but not real names that merely contain the letters", () => {
    expect(testSignals({ ...base, contactName: "Cliente Prueba" }, ctx())[0]).toMatch(/nombre tipo prueba/);
    expect(testSignals({ ...base, contactName: "TEST 2" }, ctx())[0]).toMatch(/nombre tipo prueba/);
    expect(testSignals({ ...base, contactName: "Celeste Testa" }, ctx())).toEqual([]);
    expect(testSignals({ ...base, contactName: "x" }, ctx())[0]).toMatch(/1-2 letras/);
  });

  it("flags the business's own phones and phones repeated across sales", () => {
    expect(testSignals({ ...base, contactPhone: "+584247376999" }, ctx())).toContain("teléfono del propio negocio (dueño, equipo o vendedor)");
    const repeated = ctx({ phoneSaleCount: new Map([["+584241234567", 3]]) });
    expect(testSignals(base, repeated)).toContain("teléfono repetido en 3 ventas");
    const twice = ctx({ phoneSaleCount: new Map([["+584241234567", 2]]) });
    expect(testSignals(base, twice)).toEqual([]);
  });

  it("flags early-morning sales in Venezuela time (UTC-4)", () => {
    const s = { ...base, createdAt: new Date("2026-10-10T07:15:00Z") }; // 03:15 VET
    expect(testSignals(s, ctx())).toEqual(["madrugada (03:15 VET)"]);
    expect(testSignals({ ...base, createdAt: new Date("2026-10-10T10:00:00Z") }, ctx())).toEqual([]); // 06:00 VET
  });

  it("flags token and round amounts, not multiples of the price", () => {
    expect(testSignals({ ...base, amountPaid: 1 }, ctx())).toEqual(["monto simbólico ($1)"]);
    expect(testSignals({ ...base, amountPaid: 100 }, ctx())[0]).toMatch(/monto redondo \$100/);
    expect(testSignals({ ...base, amountPaid: 110 }, ctx())).toEqual([]); // 2 × $55
    expect(testSignals({ ...base, amountPaid: 550 }, ctx())).toEqual([]); // 10 × $55, also multiple of 50
    expect(testSignals({ ...base, amountPaid: 0 }, ctx())).toEqual([]); // apartado sin abono: legit
  });
});

describe("helpers", () => {
  it("vetTime converts to Venezuela time", () => {
    expect(vetTime(new Date("2026-10-12T00:11:26Z"))).toEqual({ hour: 20, label: "20:11 VET" });
  });

  it("countPhones counts sales per phone", () => {
    expect(countPhones([{ contactPhone: "a" }, { contactPhone: "a" }, { contactPhone: "b" }])).toEqual(new Map([["a", 2], ["b", 1]]));
  });
});
