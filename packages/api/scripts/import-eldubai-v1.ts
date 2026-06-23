// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / RECONCILIACIÓN de "El Dubai" desde v1 (riffas.info, export-all.json)
// hacia prod (rifacil v2). ALCANCE: SOLO El Dubai.
//
// Política (decidida con el dueño): "v1 MANDA, pero PROTEGE ventas nuevas".
//   - Una venta del sistema nuevo (Sale.source != "import", p.ej. public/vendor/manual)
//     NUNCA se pisa: se reporta en la lista PROTEGIDOS con nombre/teléfono.
//   - Lo que viene del import viejo (Sale.source == "import") se reconcilia a v1.
//
// Seguridad:
//   - BACKUP read-only SIEMPRE (incluso en dry-run), ANTES de clasificar/escribir:
//     vuelca RaffleNumber + Sale + Payment + Contact de El Dubai a JSON.
//   - DRY-RUN por defecto: clasifica y reporta, NO escribe. APPLY=1 para escribir.
//   - Idempotente a nivel número: match por valor entero, update sobre la fila
//     existente (preserva su string `number`), Sale por receiptNumber determinístico.
//   - NO borra la rifa (a diferencia de import-rifa96-csv.ts).
//
// Uso (apuntar SIEMPRE a prod ep-billowing-bread; confirmar la línea [host]):
//   # ver qué haría (no escribe; igual hace el backup read-only):
//   DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/import-eldubai-v1.ts
//   # aplicar (sólo tras revisar el dry-run):
//   APPLY=1 DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/import-eldubai-v1.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@riffas/db";
import { normalizePhone } from "@riffas/shared";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const RAFFLE_TITLE = "El Dubai";
const V1_RAFFLE_ID = 96;
const IMPORT_SOURCE = "import"; // marcador del import viejo (reconciliable)
const APPLY = process.env.APPLY === "1";

const EXPORT_FILE = process.argv[2] || resolve(process.cwd(), "../../migracion-riffas-info/export-all.json");
const OUT_DIR = resolve(process.cwd(), "../../migracion-riffas-info");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const hostOf = (u?: string) => u?.match(/@([^/:?]+)/)?.[1] ?? "<sin host>";
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad3 = (n: number) => String(n).padStart(3, "0");
const csvEsc = (s: unknown) => { const v = String(s ?? ""); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

type V1 = { num: number; status: "sold" | "pending"; paid: number; due: number; name: string; phone: string; address: string; reservedDate: string | null };

(async () => {
  console.log(`[host] ${hostOf(process.env.DATABASE_URL)}  |  modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe)"}`);
  console.log(`[export] ${EXPORT_FILE}`);

  // 1) Resolver usuario + rifa El Dubai en prod.
  const user = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!user) { console.error("✖ Usuario Orlando no encontrado — aborto."); process.exit(1); }
  const raffle = await prisma.raffle.findFirst({
    where: { userId: user.id, title: RAFFLE_TITLE },
    select: { id: true, title: true, totalNumbers: true, status: true },
  });
  if (!raffle) { console.error(`✖ Rifa "${RAFFLE_TITLE}" no encontrada — aborto.`); process.exit(1); }
  console.log(`[rifa] ${raffle.title} id=${raffle.id} total=${raffle.totalNumbers} status=${raffle.status}`);

  // 2) Cargar v1 (El Dubai = raffleId 96).
  const dump = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
  const v1 = new Map<number, V1>();
  for (const c of dump.clients ?? []) {
    for (const rn of c.raffleNumbers ?? []) {
      if (rn.raffleId !== V1_RAFFLE_ID) continue;
      const phone = normalizePhone(c.phone || "", "VE") || (c.phone || "").trim() || `importv1-dubai-${rn.number}`;
      v1.set(rn.number, {
        num: rn.number, status: rn.status,
        paid: Number(rn.paymentAmount) || 0, due: Number(rn.paymentDue) || 0,
        name: `${(c.firstName || "").trim()} ${(c.lastName || "").trim()}`.trim() || "Sin nombre",
        phone, address: (c.address || "").replace(/\s+/g, " ").trim(),
        reservedDate: rn.reservedDate ?? null,
      });
    }
  }
  console.log(`[v1] números ocupados en El Dubai: ${v1.size}`);

  // 3) Cargar filas de prod (con su venta y titular).
  const prodRows = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id },
    select: {
      id: true, number: true, status: true, saleId: true,
      sale: { select: { id: true, source: true, receiptNumber: true, amountPaid: true, status: true } },
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
    takenAt: STAMP, raffleId: raffle.id, host: hostOf(process.env.DATABASE_URL),
    raffleNumbers: prodRows, sales, contacts,
  }, null, 2));
  console.log(`\n💾 BACKUP read-only escrito: ${backupPath}`);
  console.log(`   RaffleNumber=${prodRows.length}  Sale=${sales.length}  Payment=${sales.reduce((a, s) => a + s.payments.length, 0)}  Contact=${contacts.length}`);

  // 5) Histograma de `source` de los ocupados en prod (para validar el marcador del import viejo).
  const occProd = prodRows.filter((r) => r.status !== "AVAILABLE");
  const srcHist: Record<string, number> = {};
  for (const r of occProd) { const k = r.sale ? `source=${r.sale.source ?? "null"}` : "sin-sale"; srcHist[k] = (srcHist[k] || 0) + 1; }
  console.log(`\n[prod] ocupados=${occProd.length}  histograma source:`, srcHist);

  // 6) Clasificación.
  const isImport = (r: (typeof prodRows)[number]) => !!r.sale && r.sale.source === IMPORT_SOURCE;
  const buckets = { CREATE: [] as any[], UPDATE: [] as any[], SAME: [] as any[], FREE: [] as any[], PROTECT_CONFLICT: [] as any[], PROTECT_KEEP: [] as any[], ANOMALY: [] as any[] };

  const positions = new Set<number>([...v1.keys(), ...prod.keys()]);
  for (const i of positions) {
    const a = v1.get(i);
    const p = prod.get(i);
    const pOcc = !!p && p.status !== "AVAILABLE";
    if (a) {
      const target = a.status === "sold" ? "PAID" : "RESERVED";
      if (!p) { buckets.ANOMALY.push({ num: i, why: "v1 ocupado pero no existe fila en prod" }); continue; }
      if (!pOcc) { buckets.CREATE.push({ num: i, target, v1: a }); continue; }
      if (isImport(p)) {
        const samePaid = r2(Number(p.sale!.amountPaid)) === r2(a.paid);
        const sameStatus = p.status === target;
        const samePhone = (p.contact?.phone ?? "") === a.phone;
        if (samePaid && sameStatus && samePhone) buckets.SAME.push({ num: i });
        else buckets.UPDATE.push({ num: i, target, from: { status: p.status, paid: Number(p.sale!.amountPaid), phone: p.contact?.phone }, to: { status: target, paid: a.paid, phone: a.phone, name: a.name } });
      } else {
        buckets.PROTECT_CONFLICT.push({ num: i, prod: { name: p.contact?.name, phone: p.contact?.phone, source: p.sale?.source ?? null, status: p.status }, v1: { name: a.name, phone: a.phone } });
      }
    } else {
      if (!pOcc) continue; // libre en ambos
      if (isImport(p!)) buckets.FREE.push({ num: i, from: { name: p!.contact?.name, phone: p!.contact?.phone, status: p!.status } });
      else buckets.PROTECT_KEEP.push({ num: i, prod: { name: p!.contact?.name, phone: p!.contact?.phone, source: p!.sale?.source ?? null, status: p!.status } });
    }
  }

  // 7) Reporte.
  console.log(`\n── DRY-RUN: reporte por número ──`);
  console.log(`  CREATE  (prod AVAILABLE → v1 ocupado, se llena)      : ${buckets.CREATE.length}`);
  console.log(`  UPDATE  (import viejo difiere de v1, se reconcilia)  : ${buckets.UPDATE.length}`);
  console.log(`  SAME    (import viejo ya == v1, no se toca)          : ${buckets.SAME.length}`);
  console.log(`  FREE    (import viejo ocupado, v1 libre → liberar)   : ${buckets.FREE.length}`);
  console.log(`  PROTEGIDOS (venta NUEVA, NO se pisa)                 : ${buckets.PROTECT_CONFLICT.length + buckets.PROTECT_KEEP.length}`);
  console.log(`     ├─ conflicto (v1 lo quiere, venta nueva lo tiene) : ${buckets.PROTECT_CONFLICT.length}`);
  console.log(`     └─ keep (v1 libre, venta nueva lo tiene)          : ${buckets.PROTECT_KEEP.length}`);
  console.log(`  ANOMALÍA (v1 ocupado sin fila en prod)               : ${buckets.ANOMALY.length}`);

  // Lista COMPLETA de protegidos con nombre/teléfono (lo que el dueño quiere revisar).
  const protectedAll = [...buckets.PROTECT_CONFLICT, ...buckets.PROTECT_KEEP].sort((x, y) => x.num - y.num);
  if (protectedAll.length) {
    console.log(`\n── PROTEGIDOS (ventas del sistema nuevo, revisar antes de aplicar) ──`);
    for (const r of protectedAll)
      console.log(`  #${pad3(r.num)}  ${r.prod.status.padEnd(8)} src=${String(r.prod.source).padEnd(7)}  ${r.prod.name ?? "?"} · ${r.prod.phone ?? "?"}${r.v1 ? `   (v1 lo asigna a: ${r.v1.name} · ${r.v1.phone})` : ""}`);
  } else {
    console.log(`\n── PROTEGIDOS: ninguno (no hay ventas nuevas en El Dubai todavía) ──`);
  }

  // CSV completo por número para revisión offline.
  const csvPath = resolve(OUT_DIR, `dryrun-eldubai-${STAMP}.csv`);
  const header = ["accion", "number", "prod_status", "prod_source", "prod_holder", "prod_phone", "v1_status", "v1_paid", "v1_due", "v1_holder", "v1_phone"];
  const lines = [header.join(",")];
  const emit = (accion: string, num: number) => {
    const a = v1.get(num); const p = prod.get(num);
    lines.push([accion, num, p?.status ?? "", p?.sale?.source ?? "", p?.contact?.name ?? "", p?.contact?.phone ?? "", a?.status ?? "", a?.paid ?? "", a?.due ?? "", a?.name ?? "", a?.phone ?? ""].map(csvEsc).join(","));
  };
  for (const b of buckets.CREATE) emit("CREATE", b.num);
  for (const b of buckets.UPDATE) emit("UPDATE", b.num);
  for (const b of buckets.FREE) emit("FREE", b.num);
  for (const b of buckets.PROTECT_CONFLICT) emit("PROTECT_CONFLICT", b.num);
  for (const b of buckets.PROTECT_KEEP) emit("PROTECT_KEEP", b.num);
  for (const b of buckets.ANOMALY) emit("ANOMALY", b.num);
  for (const b of buckets.SAME) emit("SAME", b.num);
  writeFileSync(csvPath, lines.join("\n"));
  console.log(`\n📄 Detalle por número (todas las acciones): ${csvPath}`);

  // 8) APPLY (sólo con APPLY=1, tras revisión).
  if (!APPLY) {
    console.log(`\n(DRY RUN) No se escribió NADA en la DB. Revisá el reporte y el CSV.`);
    console.log(`Para aplicar: APPLY=1 con la MISMA DATABASE_URL/DIRECT_URL de prod.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n⚙️  APPLY: escribiendo (se saltan ${protectedAll.length} protegidos)…`);
  let created = 0, updated = 0, freed = 0;

  const upsertContact = async (a: V1) => {
    const ct = await prisma.contact.upsert({
      where: { userId_phone: { userId: user.id, phone: a.phone } },
      update: { name: a.name },
      create: { userId: user.id, name: a.name, phone: a.phone, city: a.address || null, source: "import", importedFrom: "riffas.info #96", importedAt: new Date() },
      select: { id: true },
    });
    return ct.id;
  };
  // reconcilia una fila a v1.
  //  - UPDATE: ACTUALIZA la venta del import viejo POR SU id (reusa su receiptNumber;
  //    no crea paralela ni deja huérfanos).
  //  - CREATE: crea venta nueva con receiptNumber determinístico (idempotente en re-run).
  const writeOne = async (num: number, a: V1, target: "PAID" | "RESERVED") => {
    const existing = prod.get(num)!;
    const contactId = await upsertContact(a);
    const finalAmount = r2(a.paid + a.due) || 0;
    const isPaid = target === "PAID";
    const existingSale = existing.sale && existing.sale.source === IMPORT_SOURCE ? existing.sale : null;

    let saleId: string, receiptNumber: string;
    if (existingSale) {
      receiptNumber = existingSale.receiptNumber;
      await prisma.sale.update({
        where: { id: existingSale.id },
        data: { contactId, totalAmount: String(finalAmount), finalAmount: String(finalAmount), amountPaid: String(a.paid), status: isPaid ? "PAID" : "RESERVED", paidAt: isPaid ? new Date() : null },
      });
      saleId = existingSale.id;
    } else {
      receiptNumber = `IMPV1-DUBAI-${pad3(num)}`;
      const sale = await prisma.sale.upsert({
        where: { receiptNumber },
        update: { contactId, totalAmount: String(finalAmount), finalAmount: String(finalAmount), amountPaid: String(a.paid), status: isPaid ? "PAID" : "RESERVED", paidAt: isPaid ? new Date() : null },
        create: { raffleId: raffle.id, userId: user.id, contactId, numbers: [existing.number], totalNumbers: 1, totalAmount: String(finalAmount), finalAmount: String(finalAmount), amountPaid: String(a.paid), status: isPaid ? "PAID" : "RESERVED", paidAt: isPaid ? new Date() : null, receiptNumber, source: "import" },
        select: { id: true },
      });
      saleId = sale.id;
    }
    // abono consolidado idempotente.
    await prisma.payment.deleteMany({ where: { saleId } });
    if (a.paid > 0) await prisma.payment.create({ data: { saleId, amount: String(a.paid), method: "EFECTIVO_USD", status: "CONFIRMED" } });
    await prisma.raffleNumber.update({
      where: { raffleId_number: { raffleId: raffle.id, number: existing.number } },
      data: { status: target, contactId, saleId, soldAt: a.reservedDate ? new Date(a.reservedDate) : new Date(), paidAt: isPaid ? new Date() : null, receiptNumber },
    });
  };

  for (const b of buckets.CREATE) { await writeOne(b.num, v1.get(b.num)!, b.target); created++; }
  for (const b of buckets.UPDATE) { await writeOne(b.num, v1.get(b.num)!, b.target); updated++; }
  // FREE: liberar números que v1 ya no tiene ocupados (sólo si vienen del import viejo).
  for (const b of buckets.FREE) {
    const p = prod.get(b.num)!;
    await prisma.raffleNumber.update({ where: { raffleId_number: { raffleId: raffle.id, number: p.number } }, data: { status: "AVAILABLE", contactId: null, saleId: null, soldAt: null, paidAt: null, receiptNumber: null } });
    if (p.sale) await prisma.sale.update({ where: { id: p.sale.id }, data: { status: "CANCELLED" } });
    freed++;
  }

  // 9) Refrescar denormalizados del panel admin (soldCount/revenue) desde la realidad.
  const occupiedNow = await prisma.raffleNumber.count({ where: { raffleId: raffle.id, status: { not: "AVAILABLE" } } });
  const paidAgg = await prisma.sale.aggregate({ where: { raffleId: raffle.id, status: { not: "CANCELLED" } }, _sum: { amountPaid: true, finalAmount: true } });
  const revenue = r2(Number(paidAgg._sum.amountPaid ?? 0));
  const deuda = r2(Number(paidAgg._sum.finalAmount ?? 0) - revenue);
  await prisma.raffle.update({ where: { id: raffle.id }, data: { soldCount: occupiedNow, revenue: String(revenue) } });

  // 10) Verificación post-escritura (lo que el dueño valida).
  const after = await prisma.raffleNumber.groupBy({ by: ["status"], where: { raffleId: raffle.id }, _count: { _all: true } });
  const byStatus: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, PAID: 0 };
  for (const g of after) byStatus[g.status] = g._count._all;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  console.log(`\n✅ APPLY listo. created=${created} updated=${updated} freed=${freed} protegidos_saltados=${protectedAll.length}`);
  console.log(`── DESPUÉS (prod) ──`);
  console.log(`  ocupados=${total - byStatus.AVAILABLE}  disponibles=${byStatus.AVAILABLE}  (total ${total})`);
  console.log(`  PAID=${byStatus.PAID}  RESERVED=${byStatus.RESERVED}  SOLD=${byStatus.SOLD}  AVAILABLE=${byStatus.AVAILABLE}`);
  console.log(`  raffle.soldCount=${occupiedNow}  raffle.revenue=$${revenue.toFixed(2)} (abonado)  deuda=$${deuda.toFixed(2)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("❌ Error:", e); process.exit(1); });
