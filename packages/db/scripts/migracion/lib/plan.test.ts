import { describe, expect, it } from "vitest";
import { fitAbonos, mapNumberStatus, mapPaymentMethod, planRaffle, titleKey, type PlanOptions } from "./plan";

const NOW = new Date("2026-10-13T12:00:00Z");
const opts: PlanOptions = {
  now: NOW,
  cashMethod: "EFECTIVO_USD",
  // Minimal stand-in for @riffas/shared normalizePhone: VE locals and +intl.
  normalizePhone: (raw) => {
    const d = raw.replace(/[^\d+]/g, "");
    if (d.startsWith("+") && d.length >= 11) return d;
    if (/^0\d{10}$/.test(d)) return `+58${d.slice(1)}`;
    return null;
  },
  countryOf: (e164) => (e164.startsWith("+57") ? "CO" : e164.startsWith("+58") ? "VE" : null),
};

const PM = [
  { id: 10, payMethode: { name: "Efectivo" } },
  { id: 11, payMethode: { name: "Pago Móvil" } },
  { id: 12, payMethode: { name: "Bancolombia" } },
  { id: 13, payMethode: { name: "Trueque" } },
];

/** A 10-number raffle (000..009) at $10. */
function dump(over: { playDate?: string; clients?: any[]; board?: Record<number, any> } = {}) {
  const board = Array.from({ length: 10 }, (_, i) => ({ number: i, status: "available", ...(over.board?.[i] ?? {}) }));
  for (const c of over.clients ?? []) {
    for (const rn of c.raffleNumbers) {
      if (!over.board?.[rn.number]) board[rn.number] = { number: rn.number, status: rn.status };
    }
  }
  return {
    raffles: [{ id: 5, name: "Rifa Prueba", price: "10.00" }],
    raffleDetails: {
      "5": {
        detail: { name: "Rifa Prueba", price: "10.00", totalNumbers: 10, playDate: over.playDate ?? "2026-12-01T00:00:00Z", description: "Moto || Bono" },
        vendors: [
          { role: "responsable", user: { id: 1, firstName: "Orlando", identificationNumber: "V-12.345.678", phone: "04141112233" } },
          { role: "vendedor", user: { id: 2, firstName: "Maria", phone: "" } },
        ],
        paymethods: PM,
        recaudo: null,
      },
    },
    clients: over.clients ?? [],
    numbers: { "5": board },
  };
}

const client = (id: number, phone: string, raffleNumbers: any[]) => ({
  id, firstName: "Ana", lastName: "Pérez", phone, address: " San  Cristóbal ", raffleNumbers,
});
const rn = (number: number, status: string, paymentAmount: string, paymentDue: string, payments: any[] = []) => ({
  number, status, paymentAmount, paymentDue, raffleId: 5, reservedDate: "2026-09-01T10:00:00Z", payments,
});
const pay = (amount: string, paymentMethodId: number, createdAt: string) => ({ amount, paymentMethodId, createdAt });

describe("mapping rules kept from docs/MIGRACION-RIFFAS-INFO.md", () => {
  it("number status: sold+no debt → PAID, sold+debt → SOLD, pending → RESERVED", () => {
    expect(mapNumberStatus("sold", 0)).toBe("PAID");
    expect(mapNumberStatus("sold", 5)).toBe("SOLD");
    expect(mapNumberStatus("pending", 5)).toBe("RESERVED");
    expect(mapNumberStatus("apartado", 0)).toBe("RESERVED");
  });

  it("payment methods map as documented; efectivo follows --cash-method", () => {
    expect(mapPaymentMethod("Efectivo", "EFECTIVO_VES").method).toBe("EFECTIVO_VES");
    expect(mapPaymentMethod("Pago Móvil", "EFECTIVO_USD").method).toBe("PAGO_MOVIL");
    expect(mapPaymentMethod("BANCOLOMBIA ahorros", "EFECTIVO_USD").method).toBe("BANCOLOMBIA");
    expect(mapPaymentMethod("Transferencia", "EFECTIVO_USD").method).toBe("BANK_TRANSFER");
    expect(mapPaymentMethod("Trueque", "EFECTIVO_USD")).toEqual({ method: "CASH", known: false });
  });
});

describe("planRaffle", () => {
  it("keeps the debt of an apartado (paymentAmount is what was PAID, not the price)", () => {
    const p = planRaffle(
      dump({ clients: [client(7, "04241234567", [rn(3, "pending", "4.00", "6.00", [pay("4.00", 11, "2026-09-02T00:00:00Z")])])] }),
      "5",
      opts,
    );
    const s = p.sales[0];
    expect(s.totalAmount).toBe(10);
    expect(s.amountPaid).toBe(4);
    expect(s.status).toBe("RESERVED");
    expect(s.numbers).toEqual([{ number: "003", status: "RESERVED" }]);
    expect(p.stats.expectedDebt).toBe(6);
  });

  it("a fully paid sale keeps each abono with its method and ORIGINAL date", () => {
    const p = planRaffle(
      dump({
        clients: [client(7, "04241234567", [rn(1, "sold", "10.00", "0.00", [
          pay("6.00", 12, "2026-09-03T00:00:00Z"),
          pay("0.00", 10, "2026-09-03T00:00:00Z"),
          pay("4.00", 10, "2026-09-01T00:00:00Z"),
        ])])],
      }),
      "5",
      opts,
    );
    const s = p.sales[0];
    expect(s.status).toBe("PAID");
    expect(s.payments.map((x) => [x.amount, x.method, x.createdAt?.toISOString()])).toEqual([
      [4, "EFECTIVO_USD", "2026-09-01T00:00:00.000Z"],
      [6, "BANCOLOMBIA", "2026-09-03T00:00:00.000Z"],
    ]);
    expect(s.createdAt?.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(s.paidAt?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("ignores repeated abonos: a $25 ticket with abonos [25, 25, 25] is $25 paid, not $75", () => {
    const p = planRaffle(
      dump({
        clients: [client(7, "04241234567", [rn(1, "sold", "10.00", "0.00", [
          pay("10.00", 11, "2026-09-01T00:00:00Z"),
          pay("10.00", 11, "2026-09-02T00:00:00Z"),
          pay("10.00", 11, "2026-09-03T00:00:00Z"),
        ])])],
      }),
      "5",
      opts,
    );
    const s = p.sales[0];
    expect(s.totalAmount).toBe(10);
    expect(s.amountPaid).toBe(10);
    expect(s.payments).toEqual([{ amount: 10, method: "PAGO_MOVIL", createdAt: new Date("2026-09-01T00:00:00Z") }]);
    expect(p.stats.ledgerRevenue).toBe(30);
    expect(p.stats.expectedRevenue).toBe(10);
    expect(p.warnings.join()).toMatch(/1 numbers with MORE abonos.*\$20\.00 ignored/);
  });

  it("covers a paid amount without abono detail with one assumed payment", () => {
    const p = planRaffle(dump({ clients: [client(7, "04241234567", [rn(1, "sold", "10.00", "0.00", [pay("4.00", 11, "2026-09-01T00:00:00Z")])])] }), "5", opts);
    const s = p.sales[0];
    expect(s.amountPaid).toBe(10);
    expect(s.payments).toEqual([
      { amount: 4, method: "PAGO_MOVIL", createdAt: new Date("2026-09-01T00:00:00Z") },
      { amount: 6, method: "EFECTIVO_USD", createdAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    expect(p.warnings.join()).toMatch(/paid without abono detail: \$6\.00/);
  });

  it("warns on a sold number with $0 paid and $0 debt instead of hiding it", () => {
    const p = planRaffle(dump({ clients: [client(7, "04241234567", [rn(2, "sold", "0.00", "0.00")])] }), "5", opts);
    expect(p.sales[0].totalAmount).toBe(0);
    expect(p.warnings.join()).toMatch(/sold with \$0 paid and \$0 debt.*002/);
  });

  it("normalizes phones to E.164 and detects the country", () => {
    const p = planRaffle(dump({ clients: [client(7, "+57 300 123 4567", [rn(1, "sold", "10", "0")])] }), "5", opts);
    expect(p.sales[0].contact).toMatchObject({ phone: "+573001234567", country: "CO", realPhone: true });
    expect(p.sales[0].contact.city).toBe("San Cristóbal");
  });

  it("keeps an unparseable phone verbatim instead of losing the client", () => {
    const p = planRaffle(dump({ clients: [client(7, "Usaaa", [rn(1, "sold", "10", "0")])] }), "5", opts);
    expect(p.sales[0].contact).toMatchObject({ phone: "Usaaa", realPhone: false });
  });

  it("is DRAWN when the draw date passed, even with free numbers (Marco 13-oct)", () => {
    const p = planRaffle(dump({ playDate: "2026-04-12T03:10:00Z", clients: [client(7, "04241234567", [rn(1, "sold", "10", "0")])] }), "5", opts);
    expect(p.status).toBe("DRAWN");
    expect(planRaffle(dump(), "5", opts).status).toBe("ACTIVE");
  });

  it("board-only sold numbers become name-only contacts with an assumed cash payment", () => {
    const p = planRaffle(dump({ board: { 4: { status: "sold", firstName: "Luis", paymentAmount: "10.00", paymentDue: "0.00" } } }), "5", opts);
    expect(p.blockers).toEqual([]);
    const s = p.sales.find((x) => x.fromBoardOnly)!;
    expect(s.contact).toMatchObject({ name: "Luis", phone: "import-5-004", realPhone: false });
    expect(s.payments).toEqual([{ amount: 10, method: "EFECTIVO_USD", createdAt: null }]);
    expect(s.numbers).toEqual([{ number: "004", status: "PAID" }]);
  });

  it("does NOT drop an occupied board number that has no name (it used to become AVAILABLE)", () => {
    const p = planRaffle(dump({ board: { 6: { status: "pending" } } }), "5", opts);
    expect(p.stats.plannedOccupied).toBe(1);
    expect(p.sales[0].numbers).toEqual([{ number: "006", status: "RESERVED" }]);
    expect(p.sales[0].contact.name).toBe("Sin nombre (tablero #006)");
  });

  it("blocks when two clients hold the same number", () => {
    const p = planRaffle(
      dump({ clients: [client(7, "04241234567", [rn(2, "sold", "10", "0")]), client(8, "04241234568", [rn(2, "sold", "10", "0")])] }),
      "5",
      opts,
    );
    expect(p.blockers.join()).toMatch(/held by two sales/);
  });

  it("blocks a number outside the raffle (e.g. 1..N vs 0..N-1 numbering)", () => {
    const p = planRaffle(dump({ clients: [client(7, "04241234567", [{ ...rn(10, "sold", "10", "0") }])] }), "5", opts);
    expect(p.blockers.join()).toMatch(/outside the raffle/);
  });

  it("blocks when a client sale sits on a number the board says is available", () => {
    const p = planRaffle(dump({ clients: [client(7, "04241234567", [rn(2, "sold", "10", "0")])], board: { 2: { status: "available" } } }), "5", opts);
    expect(p.blockers.join()).toMatch(/board says available/);
  });

  it("warns on unknown payment methods and maps them to CASH", () => {
    const p = planRaffle(dump({ clients: [client(7, "04241234567", [rn(1, "sold", "10", "0", [pay("10", 13, "2026-09-01T00:00:00Z")])])] }), "5", opts);
    expect(p.sales[0].payments[0].method).toBe("CASH");
    expect(p.warnings.join()).toMatch(/unknown method/);
  });

  it("vendors get deterministic codes and normalized documents", () => {
    const p = planRaffle(dump(), "5", opts);
    expect(p.vendors).toEqual([
      expect.objectContaining({ code: "IMP-RI-1", role: "ADMIN", idDocument: "V12345678", phone: "+584141112233" }),
      expect.objectContaining({ code: "IMP-RI-2", role: "VENDEDOR", idDocument: null }),
    ]);
  });

  it("formats numbers to the raffle width", () => {
    const p = planRaffle(dump(), "5", opts);
    expect(p.universe[0]).toBe("000");
    expect(p.universe).toHaveLength(10);
  });
});

describe("fitAbonos", () => {
  const d = (s: string) => new Date(s);
  it("keeps the oldest abonos, trims the one that crosses the paid amount", () => {
    const r = fitAbonos(50, [
      { amount: 30, method: "ZELLE", createdAt: d("2026-09-02") },
      { amount: 15, method: "PAGO_MOVIL", createdAt: d("2026-09-01") },
      { amount: 20, method: "ZELLE", createdAt: d("2026-09-03") },
    ], "EFECTIVO_USD", null);
    expect(r.payments.map((p) => p.amount)).toEqual([15, 30, 5]);
    expect(r.ignored).toBe(15);
    expect(r.added).toBe(0);
  });

  it("adds nothing and keeps nothing when nothing was paid", () => {
    expect(fitAbonos(0, [{ amount: 10, method: "ZELLE", createdAt: null }], "EFECTIVO_USD", null)).toEqual({ payments: [], ignored: 10, added: 0 });
  });

  it("payments always add up to the paid amount", () => {
    const r = fitAbonos(37.5, [{ amount: 12.25, method: "ZELLE", createdAt: d("2026-09-01") }], "EFECTIVO_VES", d("2026-08-30"));
    expect(r.payments.reduce((a, p) => a + p.amount, 0)).toBe(37.5);
    expect(r.payments[1]).toEqual({ amount: 25.25, method: "EFECTIVO_VES", createdAt: d("2026-09-01") });
  });
});

describe("titleKey", () => {
  it("matches titles regardless of accents, case and punctuation", () => {
    expect(titleKey("El Dubái!")).toBe(titleKey("el dubai"));
    expect(titleKey("Gran Rifa  Resuelve")).toBe("gran rifa resuelve");
  });
});
