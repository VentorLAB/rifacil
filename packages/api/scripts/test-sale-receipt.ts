/**
 * Prueba de integración del FLUJO REAL de ventas con abonos.
 *
 * Ejercita el sale router de verdad (saleRouter.createCaller), no una réplica:
 *   1. create() → aparta 2 números con un ABONO PARCIAL (queda deuda)
 *   2. addPayment() → registra el saldo restante y la venta queda PAGADA
 * Cada paso dispara generateReceipt con los montos REALES (amountPaid), sube el
 * PNG a Cloudinary y guarda receiptUrl. Al final relee de la DB para confirmar
 * el ledger (Sale.amountPaid + Payment[]) y limpia la venta de prueba.
 *
 *   corepack pnpm --filter @riffas/db exec tsx ../api/scripts/test-sale-receipt.ts
 */
import "./_env"; // PRIMERO: puebla process.env antes de cargar el router (cloudinary.config)
import { prisma } from "@riffas/db";
import { saleRouter } from "../src/routers/sale";

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

async function main() {
  for (const k of [
    "DATABASE_URL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ]) {
    if (!process.env[k]) throw new Error(`Falta variable de entorno: ${k}`);
  }

  const user = await prisma.user.findUnique({ where: { phone: "+584241234567" } });
  if (!user) throw new Error("No existe el rifero demo. Corré el seed.");
  const raffle = await prisma.raffle.findFirst({
    where: { userId: user.id, title: { contains: "iPhone 15" } },
  });
  if (!raffle) throw new Error("No existe la rifa demo iPhone 15.");
  const contact = await prisma.contact.findUnique({
    where: { userId_phone: { userId: user.id, phone: "+584241234567" } },
  });
  if (!contact) throw new Error("No existe el contacto María Pérez.");

  // 2 números disponibles ("un par")
  const available = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id, status: "AVAILABLE" },
    orderBy: { number: "asc" },
    take: 2,
  });
  if (available.length < 2) throw new Error("No hay 2 números disponibles.");
  const numbers = available.map((n) => n.number);

  // Caller del router REAL con una sesión construida a mano (incluye los campos
  // de marca que el router lee para el recibo).
  const ctx = {
    prisma,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        brandName: user.brandName,
        brandColor: user.brandColor,
        brandLogo: user.brandLogo,
      },
    },
  } as any;
  const caller = saleRouter.createCaller(ctx);

  // ── Paso 1: apartar con abono parcial ───────────────────────────────────
  console.log("① create() — apartar con abono parcial (Pago Móvil)");
  console.log(`   Números: ${numbers.join(", ")}  ·  total ${money(Number(raffle.pricePerNumber) * numbers.length)}`);
  const created = await caller.create({
    raffleId: raffle.id,
    contactId: contact.id,
    numbers,
    paymentMethod: "PAGO_MOVIL",
    amountPaid: 2.5, // de $4.00 → deuda $1.50
    paymentReference: "PM-000111",
  });
  console.log(`   → Sale ${created.sale.id}  status=${created.sale.status}`);
  console.log(`   → Abonado ${money(created.amountPaid)}  Deuda ${money(created.debt)}  ¿saldada? ${created.isFullyPaid}`);
  console.log(`   → Recibo: ${created.sale.receiptUrl}`);

  // ── Paso 2: registrar el saldo restante ─────────────────────────────────
  console.log("\n② addPayment() — registrar el saldo restante (Efectivo USD)");
  const settled = await caller.addPayment({
    saleId: created.sale.id,
    amount: 1.5,
    paymentMethod: "EFECTIVO_USD",
    reference: "CASH-USD-01",
  });
  console.log(`   → status=${settled.sale.status}  Abonado ${money(settled.amountPaid)}  Deuda ${money(settled.debt)}  ¿saldada? ${settled.isFullyPaid}`);
  console.log(`   → Recibo actualizado: ${settled.sale.receiptUrl}`);

  // ── Verificación: releer ledger desde la DB ─────────────────────────────
  const fromDb = await prisma.sale.findUnique({
    where: { id: created.sale.id },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      finalAmount: true,
      amountPaid: true,
      receiptUrl: true,
      numbers: true,
      payments: {
        orderBy: { createdAt: "asc" },
        select: { amount: true, method: true, reference: true, status: true },
      },
    },
  });
  const numbersDb = await prisma.raffleNumber.findMany({
    where: { saleId: created.sale.id },
    select: { number: true, status: true },
  });

  console.log("\n📦 Ledger persistido en Neon:");
  console.log(JSON.stringify(fromDb, null, 2));
  console.log("   Números:", numbersDb.map((n) => `${n.number}:${n.status}`).join(", "));

  const deudaDb = Number(fromDb!.finalAmount) - Number(fromDb!.amountPaid);
  const sumPagos = fromDb!.payments.reduce((a, p) => a + Number(p.amount), 0);
  console.log("\n✔ Chequeos:");
  console.log(`   amountPaid (${money(fromDb!.amountPaid)}) === suma de pagos (${money(sumPagos)}): ${Number(fromDb!.amountPaid) === sumPagos}`);
  console.log(`   deuda calculada total-abonado = ${money(deudaDb)} (esperado $0.00)`);
  console.log(`   status PAID: ${fromDb!.status === "PAID"}`);

  // ── Limpieza: el seed provee la venta persistente; este arnés es efímero ──
  await prisma.sale.delete({ where: { id: created.sale.id } }); // cascada a Payment
  await prisma.raffleNumber.updateMany({
    where: { raffleId: raffle.id, number: { in: numbers } },
    data: {
      status: "AVAILABLE",
      contactId: null,
      saleId: null,
      soldAt: null,
      paidAt: null,
      paymentMethod: null,
      receiptNumber: null,
      receiptUrl: null,
    },
  });
  console.log("\n🧹 Venta de prueba eliminada y números liberados (los recibos quedan en Cloudinary como evidencia).");
}

main()
  .catch((e) => {
    console.error("\n❌ Falló la prueba de venta/abonos:\n", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
