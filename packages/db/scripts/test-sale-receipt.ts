/**
 * Prueba end-to-end del flujo de venta + recibo server-side.
 *
 * Replica lo que hace `saleRouter.create` (packages/api/src/routers/sale.ts)
 * pero sin sesión tRPC: crea una venta real de la rifa demo "iPhone 15" para
 * María Pérez con un ABONO PARCIAL, dispara generateReceipt (Satori -> PNG ->
 * Cloudinary) y guarda el receiptUrl en el Sale.
 *
 *   pnpm --filter @riffas/db exec tsx scripts/test-sale-receipt.ts
 */
import "./_env"; // PRIMERO: puebla process.env antes de cargar receipt.ts
import { prisma } from "../src";
import { generateReceipt } from "../../shared/src/receipt";

const money = (n: number) => `$${n.toFixed(2)}`;

async function main() {
  // Sanidad de credenciales (sin imprimir secretos)
  for (const k of [
    "DATABASE_URL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ]) {
    if (!process.env[k]) throw new Error(`Falta variable de entorno: ${k}`);
  }
  console.log(`☁️  Cloudinary cloud: ${process.env.CLOUDINARY_CLOUD_NAME}`);

  // 1) Rifero demo
  const user = await prisma.user.findUnique({
    where: { phone: "+584241234567" },
  });
  if (!user) throw new Error("No existe el rifero demo. Corré `pnpm db:seed`.");

  // 2) Rifa demo iPhone 15
  const raffle = await prisma.raffle.findFirst({
    where: { userId: user.id, title: { contains: "iPhone 15" } },
  });
  if (!raffle) throw new Error("No existe la rifa demo iPhone 15. Corré seed.");

  // 3) Contacto María Pérez
  const contact = await prisma.contact.findUnique({
    where: { userId_phone: { userId: user.id, phone: "+584241234567" } },
  });
  if (!contact) throw new Error("No existe el contacto María Pérez. Corré seed.");

  // 4) Tomar 2 números disponibles ("un par de números")
  const available = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id, status: "AVAILABLE" },
    orderBy: { number: "asc" },
    take: 2,
  });
  if (available.length < 2)
    throw new Error("No hay 2 números disponibles en la rifa demo.");
  const numbers = available.map((n) => n.number);

  // 5) Precios: total = precio/número × cantidad; abono parcial -> deuda
  const price = Number(raffle.pricePerNumber); // 2.00
  const totalAmount = Number((price * numbers.length).toFixed(2)); // 4.00
  const abonado = 2.5; // abono parcial -> deuda 1.50
  const deuda = Number((totalAmount - abonado).toFixed(2));

  const rate = await prisma.exchangeRate.findFirst({
    where: { userId: user.id, isActive: true },
  });
  const vesPerUsd = rate ? Number(rate.vesPerUsd) : null;

  const receiptNumber = `R-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;

  console.log("\n🧾 Venta de prueba:");
  console.log(`   Rifa:      ${raffle.title}`);
  console.log(`   Comprador: ${contact.name} (${contact.phone})`);
  console.log(`   Números:   ${numbers.join(", ")}`);
  console.log(`   Valor total: ${money(totalAmount)}`);
  console.log(`   Abonado:     ${money(abonado)}`);
  console.log(`   Deuda:       ${money(deuda)}`);
  if (vesPerUsd) console.log(`   Tasa:        ${vesPerUsd} VES/USD`);

  // 6) Crear Sale (status PENDING porque queda saldo pendiente).
  //    finalAmount = lo abonado (la plantilla lo lee como "Abonado").
  const sale = await prisma.sale.create({
    data: {
      raffleId: raffle.id,
      contactId: contact.id,
      userId: user.id,
      numbers,
      totalNumbers: numbers.length,
      totalAmount: totalAmount.toFixed(2),
      finalAmount: abonado.toFixed(2),
      rateUsed: vesPerUsd ? vesPerUsd.toFixed(4) : undefined,
      amountVes: vesPerUsd ? (abonado * vesPerUsd).toFixed(2) : undefined,
      status: "PENDING",
      paymentMethod: "CASH",
      receiptNumber,
      source: "test-script",
    },
    include: { contact: true, raffle: true },
  });
  console.log(`\n✅ Sale creado: ${sale.id} (recibo ${sale.receiptNumber})`);

  // 7) Marcar números como SOLD y enlazarlos a la venta
  await prisma.raffleNumber.updateMany({
    where: { raffleId: raffle.id, number: { in: numbers } },
    data: {
      status: "SOLD",
      contactId: contact.id,
      saleId: sale.id,
      soldAt: new Date(),
      receiptNumber,
    },
  });

  // 8) Disparar generateReceipt (Satori -> PNG -> Cloudinary)
  console.log("\n🎨 Generando recibo (Satori -> PNG -> Cloudinary)...");
  const receiptUrl = await generateReceipt({
    sale,
    raffle,
    contact: sale.contact,
    brandName: user.brandName || user.name,
    brandLogo: user.brandLogo,
    brandColor: user.brandColor,
  });
  console.log(`✅ Subido a Cloudinary:\n   ${receiptUrl}`);

  // 9) Guardar receiptUrl en Sale (+ números)
  await prisma.sale.update({
    where: { id: sale.id },
    data: { receiptUrl, receiptSent: false },
  });
  await prisma.raffleNumber.updateMany({
    where: { saleId: sale.id },
    data: { receiptUrl },
  });

  // 10) Releer de la DB para confirmar persistencia
  const saved = await prisma.sale.findUnique({
    where: { id: sale.id },
    select: {
      id: true,
      receiptNumber: true,
      receiptUrl: true,
      totalAmount: true,
      finalAmount: true,
      status: true,
      numbers: true,
    },
  });

  console.log("\n📦 Sale persistido en Neon:");
  console.log(JSON.stringify(saved, null, 2));
  console.log("\n🔗 secure_url del recibo:");
  console.log(saved?.receiptUrl);
}

main()
  .catch((e) => {
    console.error("\n❌ Falló el flujo de venta/recibo:\n", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
