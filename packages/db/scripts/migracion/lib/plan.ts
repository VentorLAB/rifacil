/**
 * Pure planning for the riffas.info → rifacil import (no database access).
 *
 * Turns the JSON dump produced by export-riffas-info.mjs into a per-raffle plan
 * and checks the invariants that must hold BEFORE anything is written. The
 * importer (import-riffas-info.ts) only executes plans with zero blockers.
 *
 * Mapping decisions validated with Marco (docs/MIGRACION-RIFFAS-INFO.md):
 *  - Number status: sold + no debt → PAID · sold + debt → SOLD ·
 *    apartado/pending → RESERVED.
 *  - Payment methods: efectivo → --cash-method (default EFECTIVO_USD),
 *    Zelle, Pago Móvil, Bancolombia, Nequi, Binance, Zinli, transfer → BANK_TRANSFER,
 *    anything else → CASH with a warning.
 *  - Sales grouped per client × raffle; every real abono becomes a CONFIRMED
 *    Payment with its original date.
 *  - Numbers occupied on the board without a client record (873 in raffle 73)
 *    become a name-only contact with an assumed cash payment when sold.
 *
 * Data facts (verified on the 2026-07-11 dump): `paymentAmount` is what was
 * ALREADY PAID for the number, not its price; `paymentDue` is the remaining
 * debt. The number's total is therefore paid + due.
 */

export type PaymentMethodName =
  | "PAGO_MOVIL" | "BINANCE" | "ZELLE" | "EFECTIVO_USD" | "EFECTIVO_VES" | "TRANSFERENCIA_VES"
  | "NEQUI" | "DAVIPLATA" | "PSE" | "BANK_TRANSFER" | "MERCADOPAGO" | "STRIPE" | "WOMPI" | "CASH"
  | "ZINLI" | "BANCOLOMBIA";

export type NumberStatusName = "PAID" | "SOLD" | "RESERVED";

export interface PlanOptions {
  now: Date;
  cashMethod: PaymentMethodName;
  /** E.164 or null; injected so the planner stays pure (normalizePhone from @riffas/shared). */
  normalizePhone: (raw: string) => string | null;
  /** ISO country for an E.164 phone, or null. */
  countryOf: (e164: string) => string | null;
}

export interface PlannedContact {
  phone: string;
  name: string;
  city: string | null;
  country: string;
  /** false for placeholder / unparseable phones. */
  realPhone: boolean;
}

export interface PlannedPayment {
  amount: number;
  method: PaymentMethodName;
  createdAt: Date | null;
}

export interface PlannedNumber {
  number: string;
  status: NumberStatusName;
}

export interface PlannedSale {
  receiptNumber: string;
  contact: PlannedContact;
  numbers: PlannedNumber[];
  totalAmount: number;
  amountPaid: number;
  status: "PAID" | "RESERVED";
  createdAt: Date | null;
  paidAt: Date | null;
  /** riffas.info user id of whoever registered the first real payment, if known. */
  vendorExtUserId: string | null;
  payments: PlannedPayment[];
  fromBoardOnly: boolean;
}

export interface PlannedVendor {
  extUserId: string;
  name: string;
  lastName: string | null;
  idDocument: string | null;
  phone: string;
  role: "ADMIN" | "VENDEDOR";
  /** Deterministic code so re-runs find the same vendor (Vendor.code is unique). */
  code: string;
}

export interface RafflePlan {
  ext: string;
  title: string;
  description: string | null;
  prize: string;
  pricePerNumber: number;
  totalNumbers: number;
  numberWidth: number;
  /** Every number of the raffle, formatted (the board universe). */
  universe: string[];
  startDate: Date | null;
  drawDate: Date | null;
  status: "ACTIVE" | "DRAWN";
  representanteLegal: string | null;
  representanteCedula: string | null;
  loteria: string | null;
  contactWhatsapp: string | null;
  color: string;
  bannerUrl: string | null;
  bannerMobileUrl: string | null;
  sales: PlannedSale[];
  vendors: PlannedVendor[];
  /** Anything here forbids a real write for this raffle. */
  blockers: string[];
  warnings: string[];
  stats: {
    boardOccupied: number;
    plannedOccupied: number;
    clientSales: number;
    boardOnlySales: number;
    expectedRevenue: number;
    expectedDebt: number;
    appRevenue: number | null;
    byStatus: Record<NumberStatusName, number>;
    methods: Record<string, number>;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const fullName = (first: unknown, last: unknown) =>
  `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim();

export function mapPaymentMethod(
  name: string,
  cashMethod: PaymentMethodName,
): { method: PaymentMethodName; known: boolean } {
  const v = norm(name);
  if (v.includes("efectivo")) return { method: cashMethod, known: true };
  if (v.includes("bancolombia")) return { method: "BANCOLOMBIA", known: true };
  if (v.includes("nequi")) return { method: "NEQUI", known: true };
  if (v.includes("zelle")) return { method: "ZELLE", known: true };
  if (v.includes("pago movil")) return { method: "PAGO_MOVIL", known: true };
  if (v.includes("binance")) return { method: "BINANCE", known: true };
  if (v.includes("zinli")) return { method: "ZINLI", known: true };
  if (v.includes("transfer")) return { method: "BANK_TRANSFER", known: true };
  return { method: "CASH", known: false };
}

/** Number status per the validated mapping. `status` is riffas.info's own value. */
export function mapNumberStatus(status: string, due: number): NumberStatusName {
  if (status === "sold") return due > 0.005 ? "SOLD" : "PAID";
  return "RESERVED";
}

export function contactFor(
  rawPhone: unknown,
  name: string,
  city: string | null,
  placeholder: string,
  opts: PlanOptions,
): PlannedContact {
  const raw = String(rawPhone ?? "").trim();
  const e164 = raw ? opts.normalizePhone(raw) : null;
  if (e164) {
    return { phone: e164, name, city, country: opts.countryOf(e164) ?? "VE", realPhone: true };
  }
  // Unparseable phones ("Usaaa", incomplete) are kept verbatim so nothing is
  // lost; empty ones get a deterministic placeholder.
  return { phone: raw || placeholder, name, city, country: "VE", realPhone: false };
}

export function planRaffle(dump: any, ext: string, opts: PlanOptions): RafflePlan {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const listed = (dump.raffles ?? []).find((r: any) => String(r.id) === ext) ?? {};
  const det = dump.raffleDetails?.[ext] ?? {};
  const detail = det.detail ?? listed;
  const board: any[] = dump.numbers?.[ext] ?? [];
  const price = num(detail.price ?? listed.price);
  const totalNumbers = num(detail.totalNumbers ?? listed.totalNumbers) || board.length;

  // ── Universe: the board itself when complete, else 0..total-1 ──
  const boardInts = board.map((n) => num(n.number));
  const maxInt = Math.max(totalNumbers - 1, ...boardInts, 0);
  const width = Math.max(3, String(maxInt).length);
  const fmt = (n: unknown) => String(num(n)).padStart(width, "0");
  const universeInts =
    board.length === totalNumbers && totalNumbers > 0
      ? [...new Set(boardInts)].sort((a, b) => a - b)
      : Array.from({ length: totalNumbers }, (_, i) => i);
  if (board.length && board.length !== totalNumbers) {
    warnings.push(`board has ${board.length} numbers but totalNumbers=${totalNumbers}; using 0..${totalNumbers - 1}`);
  }
  const universe = universeInts.map(fmt);
  const universeSet = new Set(universe);

  // ── Payment methods of this raffle (raffle-payment-method id → name) ──
  const pmName = new Map<string, string>();
  for (const pm of det.paymethods ?? []) pmName.set(String(pm.id), String(pm.payMethode?.name ?? pm.name ?? "?"));

  // ── Status by DATE (Marco 13-oct): a past draw is DRAWN even with free numbers ──
  const drawDate = toDate(detail.playDate);
  let status: "ACTIVE" | "DRAWN" = "ACTIVE";
  if (!drawDate) warnings.push("no playDate in riffas.info: imported as ACTIVE, confirm by hand");
  else if (drawDate.getTime() < opts.now.getTime()) status = "DRAWN";

  // ── Sales from client records (the rich source: abonos with amount/method/date) ──
  const sales: PlannedSale[] = [];
  const owner = new Map<string, string>(); // formatted number → receiptNumber
  const methods: Record<string, number> = {};
  let unknownMethodPays = 0;
  let ledgerMismatch = 0;

  const claim = (n: string, receipt: string) => {
    if (!universeSet.has(n)) blockers.push(`number ${n} (${receipt}) is outside the raffle's numbers`);
    const prev = owner.get(n);
    if (prev) blockers.push(`number ${n} is held by two sales: ${prev} and ${receipt}`);
    else owner.set(n, receipt);
  };

  for (const c of dump.clients ?? []) {
    const mine = (c.raffleNumbers ?? []).filter((rn: any) => String(rn.raffleId) === ext);
    if (!mine.length) continue;
    const receiptNumber = `IMP${ext}-${c.id}`;
    const name = fullName(c.firstName, c.lastName) || "Sin nombre";
    const city = String(c.address ?? "").replace(/\s+/g, " ").trim() || null;
    const contact = contactFor(c.phone, name, city, `import-c${c.id}`, opts);

    const numbers: PlannedNumber[] = [];
    const payments: PlannedPayment[] = [];
    let total = 0;
    let firstDate: Date | null = null;
    let vendorExtUserId: string | null = null;

    for (const rn of mine) {
      const n = fmt(rn.number);
      claim(n, receiptNumber);
      const due = num(rn.paymentDue);
      const real = (rn.payments ?? []).filter((p: any) => num(p.amount) > 0);
      const ledger = r2(real.reduce((a: number, p: any) => a + num(p.amount), 0));
      if (Math.abs(ledger - num(rn.paymentAmount)) > 0.01) ledgerMismatch++;
      // Debt is exactly what riffas.info says; paid is the ledger of abonos.
      let lineTotal = r2(ledger + due);
      if (lineTotal === 0 && rn.status !== "sold") lineTotal = price; // apartado with nothing recorded
      total += lineTotal;
      numbers.push({ number: n, status: mapNumberStatus(String(rn.status), lineTotal - ledger) });

      const reserved = toDate(rn.reservedDate);
      if (reserved && (!firstDate || reserved < firstDate)) firstDate = reserved;
      for (const p of real) {
        const label = pmName.get(String(p.paymentMethodId)) ?? "?";
        const { method, known } = mapPaymentMethod(label, opts.cashMethod);
        if (!known) unknownMethodPays++;
        methods[label] = (methods[label] ?? 0) + 1;
        payments.push({ amount: r2(num(p.amount)), method, createdAt: toDate(p.createdAt) });
        if (!vendorExtUserId && p.userId != null) vendorExtUserId = String(p.userId);
      }
    }

    payments.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    const amountPaid = r2(payments.reduce((a, p) => a + p.amount, 0));
    total = r2(total);
    const paid = amountPaid >= total - 0.005;
    const firstPay = payments[0]?.createdAt ?? null;
    const lastPay = payments[payments.length - 1]?.createdAt ?? null;
    sales.push({
      receiptNumber,
      contact,
      numbers,
      totalAmount: total,
      amountPaid,
      status: paid ? "PAID" : "RESERVED",
      createdAt: firstDate ?? firstPay,
      paidAt: paid ? lastPay ?? firstDate : null,
      vendorExtUserId,
      payments,
      fromBoardOnly: false,
    });
  }
  const clientSales = sales.length;

  // ── Board-only occupied numbers (no client record): name-only contact ──
  let boardOnlyNoName = 0;
  for (const b of board) {
    if (String(b.status) === "available") continue;
    const n = fmt(b.number);
    if (owner.has(n)) continue;
    const receiptNumber = `IMP${ext}-T${n}`;
    const nameOnBoard = fullName(b.firstName, b.lastName);
    if (!nameOnBoard) boardOnlyNoName++;
    claim(n, receiptNumber);
    const sold = String(b.status) === "sold";
    const amount = r2(num(b.paymentAmount) + num(b.paymentDue)) || price;
    sales.push({
      receiptNumber,
      contact: {
        phone: `import-${ext}-${n}`,
        name: nameOnBoard || `Sin nombre (tablero #${n})`,
        city: null,
        country: "VE",
        realPhone: false,
      },
      numbers: [{ number: n, status: sold ? "PAID" : "RESERVED" }],
      totalAmount: amount,
      amountPaid: sold ? amount : 0,
      status: sold ? "PAID" : "RESERVED",
      createdAt: toDate(b.reservedDate),
      paidAt: sold ? toDate(b.reservedDate) : null,
      vendorExtUserId: null,
      payments: sold ? [{ amount, method: opts.cashMethod, createdAt: toDate(b.reservedDate) }] : [],
      fromBoardOnly: true,
    });
  }

  // ── Invariant: every number occupied on the board is occupied in the plan ──
  const boardOccupied = new Set(board.filter((b) => String(b.status) !== "available").map((b) => fmt(b.number)));
  const boardAvailable = new Set(board.filter((b) => String(b.status) === "available").map((b) => fmt(b.number)));
  const missing = [...boardOccupied].filter((n) => !owner.has(n));
  if (missing.length) blockers.push(`${missing.length} numbers occupied on the board would be AVAILABLE: ${missing.slice(0, 20).join(", ")}`);
  const ghost = [...owner.keys()].filter((n) => boardAvailable.has(n));
  if (ghost.length) {
    blockers.push(
      `${ghost.length} numbers have a client sale but the board says available (which one is right?): ${ghost.slice(0, 20).join(", ")}`,
    );
  }
  if (!board.length) warnings.push("dump has no board for this raffle: cannot cross-check occupied numbers");

  const boardOnlySales = sales.length - clientSales;
  if (boardOnlySales) {
    warnings.push(
      `${boardOnlySales} numbers sold without a client record → name-only contact` +
        (boardOnlyNoName ? ` (${boardOnlyNoName} without a name on the board)` : "") +
        `; sold ones get an assumed ${opts.cashMethod} payment`,
    );
  }
  if (unknownMethodPays) warnings.push(`${unknownMethodPays} payments with an unknown method → CASH`);
  if (ledgerMismatch) {
    warnings.push(`${ledgerMismatch} numbers where the sum of abonos ≠ riffas.info paymentAmount (abonos ledger is used; debt kept as riffas.info says)`);
  }
  if (Object.keys(methods).some((k) => norm(k).includes("efectivo"))) {
    warnings.push(`cash (efectivo) assumed ${opts.cashMethod}`);
  }

  // ── Vendors (matched by document → phone → code at write time) ──
  const vendors: PlannedVendor[] = [];
  for (const v of det.vendors ?? []) {
    const u = v.user ?? {};
    if (u.id == null) continue;
    const phoneE164 = opts.normalizePhone(String(u.phone ?? "")) ?? String(u.phone ?? "").trim();
    vendors.push({
      extUserId: String(u.id),
      name: String(u.firstName ?? "").trim() || "Vendedor",
      lastName: String(u.lastName ?? "").trim() || null,
      idDocument: String(u.identificationNumber ?? "").replace(/[^\dA-Za-z]/g, "") || null,
      phone: phoneE164,
      role: v.role === "responsable" ? "ADMIN" : "VENDEDOR",
      code: `IMP-RI-${u.id}`,
    });
  }

  const byStatus: Record<NumberStatusName, number> = { PAID: 0, SOLD: 0, RESERVED: 0 };
  for (const s of sales) for (const n of s.numbers) byStatus[n.status]++;
  const expectedRevenue = r2(sales.reduce((a, s) => a + s.amountPaid, 0));
  const expectedDebt = r2(sales.reduce((a, s) => a + (s.totalAmount - s.amountPaid), 0));
  const appRevenue = det.recaudo?.totalRecaudado != null ? num(det.recaudo.totalRecaudado) : null;
  if (appRevenue != null && Math.abs(appRevenue - expectedRevenue) > 1) {
    warnings.push(`revenue: planned $${expectedRevenue.toFixed(2)} vs riffas.info app $${appRevenue.toFixed(2)} (payments not linked to a client)`);
  }

  const prizes = String(detail.description ?? "").split("||").map((s) => s.trim()).filter(Boolean);
  return {
    ext,
    title: String(detail.name ?? listed.name ?? `Rifa ${ext}`).trim(),
    description: detail.description ? String(detail.description) : null,
    prize: prizes[0] || "Premio importado de riffas.info",
    pricePerNumber: price,
    totalNumbers,
    numberWidth: width,
    universe,
    startDate: toDate(detail.startDate),
    drawDate,
    status,
    representanteLegal: detail.nameResponsable ?? null,
    representanteCedula: detail.nitResponsable ?? null,
    loteria: detail.loteria ?? null,
    contactWhatsapp: detail.contactRifero ?? null,
    color: detail.color || "#7c3aed",
    bannerUrl: detail.banerImgUrl ?? null,
    bannerMobileUrl: detail.banerMovileImgUrl ?? null,
    sales,
    vendors,
    blockers,
    warnings,
    stats: {
      boardOccupied: boardOccupied.size,
      plannedOccupied: owner.size,
      clientSales,
      boardOnlySales,
      expectedRevenue,
      expectedDebt,
      appRevenue,
      byStatus,
      methods,
    },
  };
}

/** Normalized title used to match a raffle that already exists in rifacil. */
export const titleKey = (t: string) => norm(t).replace(/[^a-z0-9]+/g, " ").trim();
