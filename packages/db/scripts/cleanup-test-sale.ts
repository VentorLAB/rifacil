// Limpia un APARTADO DE PRUEBA en prod: borra la venta (Sale + Payments), libera
// los números (RaffleNumber -> AVAILABLE) y revierte los contadores denormalizados
// (raffle.soldCount/revenue, contact.totalTickets/totalSpent). Pensado para borrar
// la prueba que hace el rifero con su propio número, sin dejar basura.
//
// SEGURO POR DEFECTO:
//   - DRY-RUN salvo APPLY=1 (solo muestra lo que haría).
//   - Imprime un backup JSON (read-only) de lo que va a tocar ANTES de tocarlo.
//   - Exige fijar UNA venta: si el teléfono tiene >1 venta en la rifa, aborta y
//     pide RECEIPT=... para desambiguar (no adivina).
//   - Se niega a borrar ventas "grandes" (>3 números) salvo FORCE=1 (anti-accidente).
//
// Uso (PROD): cargar DATABASE_URL/DIRECT_URL de prod y correr, p.ej.:
//   PHONE="+584241234567" pnpm --filter @riffas/db exec tsx scripts/cleanup-test-sale.ts
//   # revisar el dry-run, y si está OK:
//   PHONE="+584241234567" APPLY=1 pnpm --filter @riffas/db exec tsx scripts/cleanup-test-sale.ts
//
// Variables:
//   PHONE         (requerido) teléfono usado en la prueba (cualquier formato)
//   RAFFLE_TITLE  (def "El Dubai") título de la rifa
//   RECEIPT       (opcional) receiptNumber exacto para fijar la venta
//   APPLY=1       ejecuta los borrados (sin esto: dry-run)
//   FORCE=1       permite borrar ventas de >3 números (no usar a la ligera)
import { prisma } from "../src";

const PHONE = process.env.PHONE || "";
const RAFFLE_TITLE = process.env.RAFFLE_TITLE || "El Dubai";
const RECEIPT = process.env.RECEIPT || null;
const APPLY = process.env.APPLY === "1";
const FORCE = process.env.FORCE === "1";

function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }
function digits(s: string) { return (s || "").replace(/\D/g, ""); }

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}  | modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}`);
  if (!PHONE) { console.error("Falta PHONE. Ej: PHONE=\"+584241234567\""); process.exit(1); }

  const raffle = await prisma.raffle.findFirst({
    where: { title: RAFFLE_TITLE },
    select: { id: true, title: true, soldCount: true, revenue: true },
  });
  if (!raffle) { console.error(`Rifa no encontrada: "${RAFFLE_TITLE}"`); process.exit(1); }

  // Match flexible del teléfono: por los últimos 10 dígitos significativos.
  const last10 = digits(PHONE).slice(-10);
  const contact = await prisma.contact.findFirst({
    where: { phone: { endsWith: last10 } },
    select: { id: true, name: true, phone: true, totalTickets: true, totalSpent: true },
  });
  if (!contact) { console.error(`No hay contacto con teléfono que termine en ...${last10}`); process.exit(1); }
  console.log(`[contacto] ${contact.name} · ${contact.phone}`);

  const sales = await prisma.sale.findMany({
    where: {
      raffleId: raffle.id,
      contactId: contact.id,
      ...(RECEIPT ? { receiptNumber: RECEIPT } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { payments: true, numbers_rel: { select: { id: true, number: true, status: true } } },
  });

  if (sales.length === 0) { console.error("No se encontró ninguna venta para ese contacto/rifa."); process.exit(1); }
  if (sales.length > 1 && !RECEIPT) {
    console.error(`Hay ${sales.length} ventas de este contacto en "${raffle.title}". Fijá una con RECEIPT=...:`);
    for (const s of sales) {
      console.error(`  - ${s.receiptNumber} · ${new Date(s.createdAt).toISOString()} · nums [${s.numbers.join(", ")}] · pagado ${Number(s.amountPaid)}`);
    }
    process.exit(2);
  }

  const sale = sales[0];
  const numbersCount = sale.numbers.length;

  // Backup read-only de lo que se va a tocar (capturalo del stdout antes de aplicar).
  console.log("[backup] " + JSON.stringify({
    sale: {
      id: sale.id, receiptNumber: sale.receiptNumber, status: sale.status,
      numbers: sale.numbers, totalAmount: Number(sale.totalAmount),
      amountPaid: Number(sale.amountPaid), createdAt: sale.createdAt,
    },
    payments: sale.payments.map((p) => ({ id: p.id, amount: Number(p.amount), status: p.status, method: p.method })),
    raffleNumbers: sale.numbers_rel.map((n) => ({ id: n.id, number: n.number, status: n.status })),
  }));

  if (numbersCount > 3 && !FORCE) {
    console.error(`La venta tiene ${numbersCount} números (>3). Si DE VERDAD es de prueba, repetí con FORCE=1.`);
    process.exit(3);
  }

  console.log(`[plan] borrar venta ${sale.receiptNumber}: ${sale.payments.length} pago(s), liberar ${numbersCount} número(s) [${sale.numbers.join(", ")}], revertir contadores.`);

  if (!APPLY) {
    console.log("DRY-RUN: no se escribió nada. Repetí con APPLY=1 para ejecutar.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { saleId: sale.id } });
    await tx.raffleNumber.updateMany({
      where: { saleId: sale.id },
      data: {
        status: "AVAILABLE",
        saleId: null, contactId: null, vendorId: null,
        soldAt: null, paidAt: null, paymentMethod: null,
        paymentProof: null, paymentReference: null,
        receiptNumber: null, receiptUrl: null,
        reservedAt: null, reservedUntil: null, reservedByIp: null,
        commission: null,
      },
    });
    await tx.sale.delete({ where: { id: sale.id } });
    await tx.raffle.update({
      where: { id: raffle.id },
      data: {
        soldCount: { decrement: numbersCount },
        revenue: { decrement: Number(sale.amountPaid) },
      },
    });
    await tx.contact.update({
      where: { id: contact.id },
      data: {
        totalTickets: { decrement: Math.min(contact.totalTickets, numbersCount) },
        totalSpent: { decrement: Math.min(Number(contact.totalSpent), Number(sale.amountPaid)) },
      },
    });
  });

  console.log(`✅ OK: venta ${sale.receiptNumber} borrada y ${numbersCount} número(s) liberado(s).`);
  await prisma.$disconnect();
})();
