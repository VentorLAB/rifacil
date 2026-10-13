// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / RECONCILIACIÓN de "El Dubai" desde v1 (riffas.info) hacia prod
// (rifacil v2). ALCANCE: SOLO El Dubai (#96). El resto de rifas las importa
// packages/db/scripts/migracion/import-riffas-info.ts.
//
// Política (Marco, jun-2026 y 13-oct-2026): "riffas.info MANDA, pero PROTEGE
// las ventas nuevas" y "conservar el id de la rifa y los enlaces de recibos".
//   - Una venta hecha en rifacil (Sale.source != "import") NUNCA se pisa: sale en
//     la lista PROTEGIDOS con su receiptNumber, nombre y teléfono.
//   - Las que Marco marque como PRUEBA se pasan en DROP_SALES=<receipt,receipt>:
//     se borran (con sus pagos) y sus números quedan para lo que diga v1.
//   - Lo que vino de imports viejos (Sale.source == "import") se reconcilia a v1
//     sobre la MISMA venta (mismo id → mismo enlace de recibo).
//
// Seguridad:
//   - BACKUP read-only SIEMPRE (incluso en dry-run), antes de clasificar/escribir.
//   - DRY-RUN por defecto. APPLY=1 + EXPECT_HOST=<host de DATABASE_URL> para escribir.
//   - Toda la escritura va en UNA transacción: o entra entera o no entra nada.
//   - APPLY se niega si hay ANOMALÍAS (números ocupados en el tablero de v1 que
//     no tienen ficha de cliente, o sin fila en prod).
//
// Uso (DATABASE_URL de prod en la sesión; este script NO carga el .env local):
//   tsx scripts/import-eldubai-v1.ts <dir-del-dump>/riffas-info-dump.json
//   DROP_SALES=<receipt,...> tsx scripts/import-eldubai-v1.ts <dump.json>
//   APPLY=1 EXPECT_HOST=<host> DROP_SALES=<...> tsx scripts/import-eldubai-v1.ts <dump.json>
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@riffas/db";
import { normalizePhone } from "@riffas/shared";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mapNumberStatus, mapPaymentMethod, type NumberStatusName } from "../../db/scripts/migracion/lib/plan";
import { assertExpectedHost, hostOf, recomputeContactMetrics, recomputeRaffleStats } from "../../db/scripts/migracion/lib/db-helpers";
import { countPhones, testSignals, vetTime } from "../../db/scripts/migracion/lib/test-signals";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const RAFFLE_TITLE = "El Dubai";
// The legacy domain hermanospernia2023.rifacil.vip points here (apps/web/middleware.ts).
const EXPECTED_RAFFLE_ID = "cmqh43bxj0001xm2teh6gdnel";
const V1_RAFFLE_ID = 96;
const IMPORT_SOURCE = "import";
const APPLY = process.env.APPLY === "1";
const DROP = new Set((process.env.DROP_SALES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const CASH_METHOD = (process.env.CASH_METHOD ?? "EFECTIVO_USD") as "EFECTIVO_USD" | "EFECTIVO_VES" | "CASH";

const EXPORT_FILE = process.argv[2];
if (!EXPORT_FILE) {
  console.error("uso: tsx scripts/import-eldubai-v1.ts <dir-del-dump>/riffas-info-dump.json");
  process.exit(1);
}
const OUT_DIR = dirname(resolve(EXPORT_FILE)); // junto al dump, FUERA del repo
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad3 = (n: number) => String(n).padStart(3, "0");
const csvEsc = (s: unknown) => { const v = String(s ?? ""); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const toDate = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };

type V1Pay = { amount: number; method: ReturnType<typeof mapPaymentMethod>["method"]; createdAt: Date | null };
type V1 = {
  num: number; status: string; paid: number; due: number; target: NumberStatusName;
  name: string; phone: string; address: string; reservedDate: Date | null; payments: V1Pay[];
};

(async () => {
  const url = process.env.DATABASE_URL;
  console.log(`[host] ${hostOf(url)}  |  modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe)"}`);
  if (!url) throw new Error("DATABASE_URL no está en esta sesión (este script no carga el .env local, que es DEV)");
  if (APPLY) assertExpectedHost(process.env.EXPECT_HOST, url);
  console.log(`[export] ${EXPORT_FILE}`);
  if (DROP.size) console.log(`[drop] ventas marcadas como PRUEBA: ${[...DROP].join(", ")}`);

  // 1) Resolver usuario + rifa El Dubai en prod.
  const user = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!user) { console.error("✖ Usuario Orlando no encontrado — aborto."); process.exit(1); }
  const raffle = await prisma.raffle.findFirst({
    where: { userId: user.id, title: RAFFLE_TITLE },
    select: { id: true, title: true, totalNumbers: true, status: true, pricePerNumber: true },
  });
  if (!raffle) { console.error(`✖ Rifa "${RAFFLE_TITLE}" no encontrada — aborto.`); process.exit(1); }
  console.log(`[rifa] ${raffle.title} id=${raffle.id} total=${raffle.totalNumbers} status=${raffle.status}`);
  if (raffle.id !== EXPECTED_RAFFLE_ID) {
    console.log(`⚠  el id no es ${EXPECTED_RAFFLE_ID} (el que usa middleware.ts para hermanospernia2023.rifacil.vip)`);
  }

  // 2) Cargar v1 (El Dubai = raffleId 96): fichas de cliente + tablero + métodos.
  const dump = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
  const pmName = new Map<string, string>();
  for (const pm of dump.raffleDetails?.[V1_RAFFLE_ID]?.paymethods ?? []) pmName.set(String(pm.id), String(pm.payMethode?.name ?? "?"));
  let unknownMethods = 0;
  const v1 = new Map<number, V1>();
  for (const c of dump.clients ?? []) {
    for (const rn of c.raffleNumbers ?? []) {
      if (Number(rn.raffleId) !== V1_RAFFLE_ID) continue;
      const phone = normalizePhone(c.phone || "", "VE") || (c.phone || "").trim() || `importv1-dubai-${rn.number}`;
      const payments: V1Pay[] = (rn.payments ?? [])
        .filter((p: any) => Number(p.amount) > 0)
        .map((p: any) => {
          const { method, known } = mapPaymentMethod(pmName.get(String(p.paymentMethodId)) ?? "?", CASH_METHOD);
          if (!known) unknownMethods++;
          return { amount: r2(Number(p.amount)), method, createdAt: toDate(p.createdAt) };
        })
        .sort((a: V1Pay, b: V1Pay) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
      // paymentAmount es lo YA abonado; el abonado real es el ledger de abonos.
      const paid = r2(payments.reduce((a, p) => a + p.amount, 0));
      const due = r2(Number(rn.paymentDue) || 0);
      v1.set(Number(rn.number), {
        num: Number(rn.number), status: String(rn.status), paid, due,
        target: mapNumberStatus(String(rn.status), due),
        name: `${(c.firstName || "").trim()} ${(c.lastName || "").trim()}`.trim() || "Sin nombre",
        phone, address: (c.address || "").replace(/\s+/g, " ").trim(),
        reservedDate: toDate(rn.reservedDate), payments,
      });
    }
  }
  console.log(`[v1] números con ficha de cliente en El Dubai: ${v1.size}${unknownMethods ? `  (⚠ ${unknownMethods} abonos con método desconocido → CASH)` : ""}`);

  // Cruce con el tablero: un número ocupado en v1 SIN ficha quedaría libre en
  // rifacil → doble venta. Es una anomalía que bloquea el APPLY.
  const board: any[] = dump.numbers?.[V1_RAFFLE_ID] ?? [];
  const boardOnly = board.filter((b) => String(b.status) !== "available" && !v1.has(Number(b.number))).map((b) => Number(b.number));
  const boardFreeButClient = board.filter((b) => String(b.status) === "available" && v1.has(Number(b.number))).map((b) => Number(b.number));
  if (!board.length) console.log("⚠  el dump no trae el tablero de la rifa 96: no se puede cruzar");

  // 3) Cargar filas de prod (con su venta y titular).
  const prodRows = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id },
    select: {
      id: true, number: true, status: true, saleId: true,
      sale: { select: { id: true, source: true, receiptNumber: true, amountPaid: true, status: true, contactId: true, numbers: true } },
      contact: { select: { name: true, phone: true } },
    },
  });
  const prod = new Map<number, (typeof prodRows)[number]>();
  for (const r of prodRows) { const i = parseInt(r.number, 10); if (!Number.isNaN(i)) prod.set(i, r); }
  console.log(`[prod] filas RaffleNumber: ${prodRows.length}`);

  // 4) BACKUP read-only (SIEMPRE, antes de cualquier escritura).
  const sales = await prisma.sale.findMany({ where: { raffleId: raffle.id }, include: { payments: true } });
  const contacts = await prisma.contact.findMany({
    where: { userId: user.id, numbers: { some: { raffleId: raffle.id } } },
  });
  const backupPath = resolve(OUT_DIR, `backup-eldubai-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify({
    takenAt: STAMP, raffleId: raffle.id, host: hostOf(url),
    raffleNumbers: prodRows, sales, contacts,
  }, null, 2));
  console.log(`\n💾 BACKUP read-only escrito: ${backupPath}`);
  console.log(`   RaffleNumber=${prodRows.length}  Sale=${sales.length}  Payment=${sales.reduce((a, s) => a + s.payments.length, 0)}  Contact=${contacts.length}`);

  // DROP_SALES: solo ventas de ESTA rifa y que NO vengan de un import.
  const dropSales = sales.filter((s) => DROP.has(s.receiptNumber));
  const dropMissing = [...DROP].filter((r) => !dropSales.some((s) => s.receiptNumber === r));
  const dropInvalid = dropSales.filter((s) => s.source === IMPORT_SOURCE);
  if (dropMissing.length) { console.error(`✖ DROP_SALES no encontradas en El Dubai: ${dropMissing.join(", ")} — aborto.`); process.exit(1); }
  if (dropInvalid.length) { console.error(`✖ DROP_SALES solo admite ventas hechas en rifacil (no imports): ${dropInvalid.map((s) => s.receiptNumber).join(", ")} — aborto.`); process.exit(1); }
  const droppedIds = new Set(dropSales.map((s) => s.id));
  const isDropped = (r: (typeof prodRows)[number]) => !!r.saleId && droppedIds.has(r.saleId);

  // 5) Histograma de `source` de los ocupados en prod.
  const occProd = prodRows.filter((r) => r.status !== "AVAILABLE");
  const srcHist: Record<string, number> = {};
  for (const r of occProd) { const k = r.sale ? `source=${r.sale.source ?? "null"}` : "sin-sale"; srcHist[k] = (srcHist[k] || 0) + 1; }
  console.log(`\n[prod] ocupados=${occProd.length}  histograma source:`, srcHist);

  // 6) Clasificación (las ventas marcadas como prueba cuentan como libres).
  const isImport = (r: (typeof prodRows)[number]) => !!r.sale && r.sale.source === IMPORT_SOURCE;
  // Older imports (import-rifa96-csv) may hold several numbers in ONE sale. Reconciling
  // number by number must not write one number's amounts over the whole sale.
  const isMulti = (r: (typeof prodRows)[number]) => !!r.sale && r.sale.numbers.length > 1;
  const multiSales = new Set(prodRows.filter((r) => isImport(r) && isMulti(r)).map((r) => r.sale!.id));
  if (multiSales.size) console.log(`[prod] ventas importadas con varios números: ${multiSales.size} (se parten en ventas por número)`);
  const buckets = { CREATE: [] as any[], UPDATE: [] as any[], SAME: [] as any[], FREE: [] as any[], PROTECT_CONFLICT: [] as any[], PROTECT_KEEP: [] as any[], ANOMALY: [] as any[] };
  for (const n of boardOnly) buckets.ANOMALY.push({ num: n, why: "ocupado en el tablero de v1 sin ficha de cliente" });
  for (const n of boardFreeButClient) buckets.ANOMALY.push({ num: n, why: "ficha de cliente en v1 pero el tablero lo da disponible" });

  const positions = new Set<number>([...v1.keys(), ...prod.keys()]);
  for (const i of positions) {
    const a = v1.get(i);
    const p = prod.get(i);
    const pOcc = !!p && p.status !== "AVAILABLE" && !isDropped(p);
    if (a) {
      if (!p) { buckets.ANOMALY.push({ num: i, why: "v1 ocupado pero no existe fila en prod" }); continue; }
      if (!pOcc) { buckets.CREATE.push({ num: i }); continue; }
      if (isImport(p)) {
        // A multi-number import sale is always split into per-number sales.
        if (isMulti(p)) { buckets.UPDATE.push({ num: i }); continue; }
        const samePaid = r2(Number(p.sale!.amountPaid)) === a.paid;
        const sameStatus = p.status === a.target;
        const samePhone = (p.contact?.phone ?? "") === a.phone;
        if (samePaid && sameStatus && samePhone) buckets.SAME.push({ num: i });
        else buckets.UPDATE.push({ num: i });
      } else {
        buckets.PROTECT_CONFLICT.push({ num: i });
      }
    } else {
      if (!pOcc) continue; // libre en ambos (o venta de prueba que se borra)
      if (isImport(p!)) buckets.FREE.push({ num: i });
      else buckets.PROTECT_KEEP.push({ num: i });
    }
  }

  // 7) Reporte.
  console.log(`\n── DRY-RUN: reporte por número ──`);
  console.log(`  CREATE  (prod libre → v1 ocupado, se llena)          : ${buckets.CREATE.length}`);
  console.log(`  UPDATE  (import viejo difiere de v1, se reconcilia)  : ${buckets.UPDATE.length}`);
  console.log(`  SAME    (import viejo ya == v1, no se toca)          : ${buckets.SAME.length}`);
  console.log(`  FREE    (import viejo ocupado, v1 libre → liberar)   : ${buckets.FREE.length}`);
  console.log(`  PROTEGIDOS (venta NUEVA, NO se pisa)                 : ${buckets.PROTECT_CONFLICT.length + buckets.PROTECT_KEEP.length}`);
  console.log(`     ├─ conflicto (v1 lo quiere, venta nueva lo tiene) : ${buckets.PROTECT_CONFLICT.length}`);
  console.log(`     └─ keep (v1 libre, venta nueva lo tiene)          : ${buckets.PROTECT_KEEP.length}`);
  console.log(`  BORRAR  (ventas de prueba en DROP_SALES)             : ${dropSales.length}`);
  console.log(`  ANOMALÍA (bloquea el APPLY)                          : ${buckets.ANOMALY.length}`);
  for (const b of buckets.ANOMALY.slice(0, 30)) console.log(`     #${pad3(b.num)}  ${b.why}`);

  // Lista de protegidos POR VENTA (lo que Marco marca: real o prueba).
  const protectedNums = [...buckets.PROTECT_CONFLICT, ...buckets.PROTECT_KEEP].map((b) => b.num);
  type Prot = { receipt: string; source: string | null; name: string; phone: string; nums: number[]; conflicts: string[]; dropped: boolean };
  const bySale = new Map<string, Prot>();
  const addProt = (n: number, dropped: boolean) => {
    const p = prod.get(n)!;
    const key = p.sale?.receiptNumber ?? `(sin venta) #${pad3(n)}`;
    const e = bySale.get(key) ?? { receipt: key, source: p.sale?.source ?? null, name: p.contact?.name ?? "?", phone: p.contact?.phone ?? "?", nums: [], conflicts: [], dropped };
    e.nums.push(n);
    const a = v1.get(n);
    if (a) e.conflicts.push(`#${pad3(n)}→${a.name} · ${a.phone}`);
    bySale.set(key, e);
  };
  for (const n of protectedNums) addProt(n, false);
  // Las ya marcadas en DROP_SALES también se listan, para confirmar la decisión.
  for (const r of prodRows) if (isDropped(r)) addProt(parseInt(r.number, 10), true);

  // 🧪 Sugerencia de "parece prueba" (solo sugiere: nada se borra sin DROP_SALES).
  const team = await prisma.user.findMany({ where: { OR: [{ id: user.id }, { businessOwnerId: user.id }] }, select: { phone: true } });
  const vendorPhones = await prisma.vendor.findMany({ where: { userId: user.id }, select: { phone: true } });
  const businessPhones = new Set([...team, ...vendorPhones].map((x) => x.phone).filter(Boolean));
  const protList = [...bySale.values()].sort((x, y) => x.nums[0] - y.nums[0]);
  const phoneSaleCount = countPhones(protList.map((e) => ({ contactPhone: e.phone })));
  const price = Number(raffle.pricePerNumber);
  const flagged: Array<Prot & { reasons: string[]; createdAt: Date | null; paid: number }> = protList.map((e) => {
    const sale = sales.find((s) => s.receiptNumber === e.receipt);
    const createdAt = sale?.createdAt ?? null;
    const paid = Number(sale?.amountPaid ?? 0);
    const reasons = createdAt
      ? testSignals({ receiptNumber: e.receipt, contactName: e.name, contactPhone: e.phone, createdAt, amountPaid: paid }, { pricePerNumber: price, businessPhones, phoneSaleCount })
      : [];
    return { ...e, reasons, createdAt, paid };
  });

  if (flagged.length) {
    const tests = flagged.filter((e) => e.reasons.length);
    console.log(`\n── PROTEGIDOS por venta: ${flagged.length} (🧪 ${tests.length} parecen de prueba; confirma cada una) ──`);
    for (const e of flagged) {
      const when = e.createdAt ? `${e.createdAt.toISOString().slice(0, 10)} ${vetTime(e.createdAt).label}` : "";
      const mark = e.reasons.length ? "🧪" : "  ";
      const state = e.dropped ? " [en DROP_SALES]" : "";
      console.log(`${mark} ${e.receipt}${state}  src=${String(e.source).padEnd(7)} ${e.name} · ${e.phone}  #${e.nums.map(pad3).join(",")}  abonado=$${e.paid}  ${when}`);
      if (e.reasons.length) console.log(`      🧪 ${e.reasons.join(" · ")}`);
      if (e.conflicts.length) console.log(`      ⚔ v1 asigna a otra persona: ${e.conflicts.join(" | ")}`);
    }
    const suggested = tests.filter((e) => !e.dropped && !e.receipt.startsWith("(sin venta)")).map((e) => e.receipt);
    if (suggested.length) console.log(`\n   Sugerencia (CONFIRMAR antes de usarla): DROP_SALES="${[...DROP, ...suggested].join(",")}"`);

    const protCsv = resolve(OUT_DIR, `protegidos-eldubai-${STAMP}.csv`);
    const rows = [["prueba", "motivos", "receipt", "en_drop_sales", "source", "nombre", "telefono", "numeros", "abonado", "fecha_vet", "conflicto_v1"].join(",")];
    for (const e of flagged) {
      rows.push([
        e.reasons.length ? "🧪" : "", e.reasons.join(" · "), e.receipt, e.dropped ? "si" : "", e.source ?? "", e.name, e.phone,
        e.nums.map(pad3).join(" "), e.paid, e.createdAt ? `${e.createdAt.toISOString().slice(0, 10)} ${vetTime(e.createdAt).label}` : "", e.conflicts.join(" | "),
      ].map(csvEsc).join(","));
    }
    writeFileSync(protCsv, rows.join("\n"));
    console.log(`📄 Lista PROTEGIDOS (para revisar con Instinct): ${protCsv}`);
  } else {
    console.log(`\n── PROTEGIDOS: ninguno ──`);
  }

  // CSV completo por número para revisión offline.
  const csvPath = resolve(OUT_DIR, `dryrun-eldubai-${STAMP}.csv`);
  const header = ["accion", "number", "prod_status", "prod_source", "prod_receipt", "prod_holder", "prod_phone", "v1_status", "v1_paid", "v1_due", "v1_holder", "v1_phone"];
  const lines = [header.join(",")];
  const emit = (accion: string, num: number) => {
    const a = v1.get(num); const p = prod.get(num);
    lines.push([accion, num, p?.status ?? "", p?.sale?.source ?? "", p?.sale?.receiptNumber ?? "", p?.contact?.name ?? "", p?.contact?.phone ?? "", a?.status ?? "", a?.paid ?? "", a?.due ?? "", a?.name ?? "", a?.phone ?? ""].map(csvEsc).join(","));
  };
  for (const [k, list] of Object.entries(buckets)) for (const b of list) emit(k, b.num);
  writeFileSync(csvPath, lines.join("\n"));
  console.log(`\n📄 Detalle por número: ${csvPath}`);

  // 8) APPLY (solo con APPLY=1, tras revisión, sin anomalías).
  if (!APPLY) {
    console.log(`\n(DRY RUN) No se escribió NADA en la DB. Revisa el reporte y el CSV.`);
    await prisma.$disconnect();
    return;
  }
  if (buckets.ANOMALY.length) throw new Error(`${buckets.ANOMALY.length} anomalías: no se aplica nada. Revisar el CSV.`);
  if (buckets.PROTECT_CONFLICT.length) {
    throw new Error(`${buckets.PROTECT_CONFLICT.length} números en conflicto con ventas nuevas: decide (DROP_SALES si son prueba) antes de aplicar.`);
  }

  console.log(`\n⚙️  APPLY en UNA transacción (protegidos intactos: ${protectedNums.length}, borradas por prueba: ${dropSales.length})…`);
  const touchedContacts = new Set<string>();
  const result = await prisma.$transaction(async (tx) => {
    let created = 0, updated = 0, freed = 0;

    // a) Ventas de prueba: fuera, con sus pagos; sus números quedan libres.
    if (dropSales.length) {
      const ids = dropSales.map((s) => s.id);
      for (const s of dropSales) touchedContacts.add(s.contactId);
      await tx.raffleNumber.updateMany({
        where: { raffleId: raffle.id, saleId: { in: ids } },
        data: { status: "AVAILABLE", contactId: null, saleId: null, vendorId: null, soldAt: null, paidAt: null, receiptNumber: null, paymentMethod: null },
      });
      await tx.sale.deleteMany({ where: { id: { in: ids } } });
    }

    const upsertContact = async (a: V1) => {
      const ct = await tx.contact.upsert({
        where: { userId_phone: { userId: user.id, phone: a.phone } },
        update: { name: a.name },
        create: { userId: user.id, name: a.name, phone: a.phone, city: a.address || null, source: "import", importedFrom: "riffas.info #96", importedAt: new Date() },
        select: { id: true },
      });
      touchedContacts.add(ct.id);
      return ct.id;
    };

    // Reconcilia un número a v1 sobre la MISMA venta del import viejo (mismo id →
    // mismo enlace de recibo) o crea una con receiptNumber determinístico.
    const writeOne = async (num: number) => {
      const a = v1.get(num)!;
      const existing = prod.get(num)!;
      const contactId = await upsertContact(a);
      const finalAmount = r2(a.paid + a.due);
      const isPaid = a.target === "PAID";
      const lastPay = a.payments[a.payments.length - 1]?.createdAt ?? null;
      const paidAt = isPaid ? lastPay ?? a.reservedDate ?? new Date() : null;
      const saleData = {
        contactId, totalAmount: String(finalAmount), finalAmount: String(finalAmount), amountPaid: String(a.paid),
        status: isPaid ? ("PAID" as const) : ("RESERVED" as const), paidAt,
      };
      const existingSale =
        existing.sale && existing.sale.source === IMPORT_SOURCE && !isDropped(existing) && !isMulti(existing) ? existing.sale : null;
      let saleId: string, receiptNumber: string;
      if (existingSale) {
        // Una venta CANCELLED del import viejo que v1 vuelve a ocupar se reactiva aquí.
        receiptNumber = existingSale.receiptNumber;
        await tx.sale.update({ where: { id: existingSale.id }, data: saleData });
        saleId = existingSale.id;
      } else {
        receiptNumber = `IMPV1-DUBAI-${pad3(num)}`;
        const sale = await tx.sale.upsert({
          where: { receiptNumber },
          update: saleData,
          create: {
            ...saleData, raffleId: raffle.id, userId: user.id, numbers: [existing.number], totalNumbers: 1,
            receiptNumber, source: IMPORT_SOURCE, ...(a.reservedDate ? { createdAt: a.reservedDate } : {}),
          },
          select: { id: true },
        });
        saleId = sale.id;
      }
      // Historial de abonos de v1: cada abono con su método y su fecha original.
      await tx.payment.deleteMany({ where: { saleId } });
      if (a.payments.length) {
        await tx.payment.createMany({
          data: a.payments.map((p) => ({
            saleId, amount: String(p.amount), method: p.method, status: "CONFIRMED" as const,
            ...(p.createdAt ? { createdAt: p.createdAt } : {}),
          })),
        });
      }
      await tx.raffleNumber.update({
        where: { raffleId_number: { raffleId: raffle.id, number: existing.number } },
        data: { status: a.target, contactId, saleId, soldAt: a.reservedDate ?? new Date(), paidAt: a.target === "PAID" ? paidAt : null, receiptNumber },
      });
    };

    for (const b of buckets.CREATE) { await writeOne(b.num); created++; }
    for (const b of buckets.UPDATE) { await writeOne(b.num); updated++; }
    // FREE: liberar números que v1 ya no tiene ocupados (solo si vienen del import viejo).
    for (const b of buckets.FREE) {
      const p = prod.get(b.num)!;
      await tx.raffleNumber.update({ where: { raffleId_number: { raffleId: raffle.id, number: p.number } }, data: { status: "AVAILABLE", contactId: null, saleId: null, soldAt: null, paidAt: null, receiptNumber: null } });
      if (p.sale) {
        // A multi-number sale is only detached here; it is removed below once empty.
        if (!isMulti(p)) await tx.sale.update({ where: { id: p.sale.id }, data: { status: "CANCELLED" } });
        touchedContacts.add(p.sale.contactId);
      }
      freed++;
    }

    // Multi-number import sales whose numbers all moved to per-number sales.
    let splitRemoved = 0;
    if (multiSales.size) {
      const empty = await tx.sale.findMany({
        where: { id: { in: [...multiSales] }, numbers_rel: { none: {} } },
        select: { id: true, contactId: true },
      });
      for (const s of empty) touchedContacts.add(s.contactId);
      await tx.sale.deleteMany({ where: { id: { in: empty.map((s) => s.id) } } });
      splitRemoved = empty.length;
      if (empty.length !== multiSales.size) {
        throw new Error(`${multiSales.size - empty.length} multi-number import sales still hold numbers after the split: aborting (nothing written)`);
      }
    }

    const stats = await recomputeRaffleStats(tx, raffle.id);
    // ALL contacts of El Dubai, not only the touched ones: the June import never
    // filled their CRM metrics (totalSpent/totalTickets/lastPurchase stayed 0).
    const holders = await tx.sale.findMany({ where: { raffleId: raffle.id }, select: { contactId: true }, distinct: ["contactId"] });
    for (const h of holders) touchedContacts.add(h.contactId);
    await recomputeContactMetrics(tx, [...touchedContacts]);
    return { created, updated, freed, splitRemoved, ...stats };
  }, { timeout: 30 * 60_000, maxWait: 30_000 });

  // 9) Verificación post-escritura.
  const after = await prisma.raffleNumber.groupBy({ by: ["status"], where: { raffleId: raffle.id }, _count: { _all: true } });
  const byStatus: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, PAID: 0 };
  for (const g of after) byStatus[g.status] = g._count._all;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  console.log(`\n✅ APPLY listo. created=${result.created} updated=${result.updated} freed=${result.freed} protegidos=${protectedNums.length} borradas=${dropSales.length} ventas-multi-partidas=${result.splitRemoved}`);
  console.log(`── DESPUÉS (prod) ──`);
  console.log(`  ocupados=${total - byStatus.AVAILABLE}  disponibles=${byStatus.AVAILABLE}  (total ${total})`);
  console.log(`  PAID=${byStatus.PAID}  RESERVED=${byStatus.RESERVED}  SOLD=${byStatus.SOLD}  AVAILABLE=${byStatus.AVAILABLE}`);
  console.log(`  raffle.soldCount=${result.soldCount}  raffle.revenue=$${result.revenue.toFixed(2)} (abonado)  deuda=$${result.debt.toFixed(2)}`);
  console.log(`  v1 esperaba ocupados=${v1.size} (+ protegidos ${protectedNums.length})`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error("❌ Error:", e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
