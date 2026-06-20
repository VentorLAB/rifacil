import "../scripts/_env"; // PRIMERO: puebla process.env (DATABASE_URL + CLOUDINARY_*) antes de instanciar Prisma / cargar receipt.ts
import { PrismaClient } from "../src/generated";
import { generateReceipt } from "../../shared/src/receipt";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clave conocida para entrar a probar: demo@rifacil.com / demo1234
  const passwordHash = await bcrypt.hash("demo1234", 12);

  // 1) Usuario rifero demo. Login por teléfono: 0424-1234567 → +584241234567 / demo1234
  const user = await prisma.user.upsert({
    where: { phone: "+584241234567" },
    update: { passwordHash },
    create: {
      email: "demo@rifacil.com",
      phone: "+584241234567",
      name: "Rifero Demo",
      passwordHash,
      role: "RIFERO",
      brandName: "Rifas El Zuliano",
      brandColor: "#16a34a",
      brandSlug: "el-zuliano",
      onboardingCompleted: true,
      settings: {
        create: {
          currency: "USD",
          timezone: "America/Caracas",
          language: "es",
          acceptedPaymentMethods: ["PAGO_MOVIL", "BINANCE", "ZELLE", "EFECTIVO_USD"],
        },
      },
      subscriptions: {
        create: {
          plan: "PRO",
          status: "ACTIVE",
          maxRaffles: 100,
          maxContacts: 100_000,
          maxVendors: 50,
          maxNumbers: 100_000,
          maxCampaignsPerMonth: 1000,
        },
      },
    },
  });

  // Limpieza de datos demo previos (sin unique natural) para que el seed sea re-ejecutable.
  await prisma.exchangeRate.deleteMany({ where: { userId: user.id } });
  await prisma.raffle.deleteMany({ where: { userId: user.id } }); // cascada a RaffleNumber

  // 2) Tasa de cambio activa (Binance P2P, ilustrativa): 1 USD = 140 VES.
  //    En producción se refresca desde Binance P2P o se fija manual en Ajustes.
  await prisma.exchangeRate.create({
    data: {
      userId: user.id,
      source: "BINANCE",
      vesPerUsd: "140.0000",
      isActive: true,
    },
  });

  // 3) Rifa demo de 3 cifras con 50 números (000–049)
  const raffle = await prisma.raffle.create({
    data: {
      userId: user.id,
      title: "Rifa Demo — iPhone 15",
      description: "Rifa de prueba para validar el flujo completo (venta + recibo).",
      prize: "iPhone 15 128GB",
      prizeValue: "800.00",
      totalNumbers: 50,
      pricePerNumber: "2.00",
      numberFormat: "000",
      startDate: new Date(),
      drawDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
    },
  });

  await prisma.raffleNumber.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      raffleId: raffle.id,
      number: String(i).padStart(3, "0"),
    })),
  });

  // 4) Contacto venezolano de prueba (idempotente por userId+phone)
  const contact = await prisma.contact.upsert({
    where: { userId_phone: { userId: user.id, phone: "+584241234567" } },
    update: {},
    create: {
      userId: user.id,
      name: "María Pérez",
      phone: "+584241234567",
      country: "VE",
      city: "Maracaibo",
      source: "seed",
      tags: ["demo"],
    },
  });

  // 5) Venta de ejemplo: APARTADO CON ABONO PARCIAL (queda deuda real).
  //    Modela el flujo nuevo: Sale + Payment(s) + amountPaid cacheado.
  const ventaNumeros = ["000", "001"];
  const precio = Number(raffle.pricePerNumber); // 2.00
  const totalVenta = Number((precio * ventaNumeros.length).toFixed(2)); // 4.00
  const abono = 2.5; // deuda 1.50
  const deuda = Number((totalVenta - abono).toFixed(2));
  const receiptNumber = `R-${Date.now()}-DEMO`;

  const sale = await prisma.sale.create({
    data: {
      raffleId: raffle.id,
      contactId: contact.id,
      userId: user.id,
      numbers: ventaNumeros,
      totalNumbers: ventaNumeros.length,
      totalAmount: totalVenta.toFixed(2),
      finalAmount: totalVenta.toFixed(2),
      amountPaid: abono.toFixed(2),
      rateUsed: "140.0000",
      amountVes: (abono * 140).toFixed(2),
      status: "RESERVED",
      paymentMethod: "PAGO_MOVIL",
      paymentReference: "PM-DEMO-0001",
      receiptNumber,
      source: "seed",
    },
    include: { contact: true, raffle: true },
  });

  await prisma.payment.create({
    data: {
      saleId: sale.id,
      amount: abono.toFixed(2),
      method: "PAGO_MOVIL",
      reference: "PM-DEMO-0001",
      status: "CONFIRMED",
    },
  });

  await prisma.raffleNumber.updateMany({
    where: { raffleId: raffle.id, number: { in: ventaNumeros } },
    data: {
      status: "RESERVED",
      contactId: contact.id,
      saleId: sale.id,
      soldAt: new Date(),
      paymentMethod: "PAGO_MOVIL",
      receiptNumber,
    },
  });

  // Stats del contacto en valores absolutos (idempotente al re-sembrar).
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      totalSpent: abono.toFixed(2),
      totalTickets: ventaNumeros.length,
      totalRaffles: 1,
      lastPurchase: new Date(),
    },
  });

  await prisma.raffle.update({
    where: { id: raffle.id },
    data: {
      soldCount: { increment: ventaNumeros.length },
      revenue: { increment: abono },
    },
  });

  // Recibo server-side (best-effort: sin credenciales de Cloudinary se omite).
  let receiptUrl: string | null = null;
  try {
    receiptUrl = await generateReceipt({
      sale,
      raffle,
      contact,
      brandName: user.brandName,
      brandColor: user.brandColor,
      brandLogo: user.brandLogo,
    });
    await prisma.sale.update({ where: { id: sale.id }, data: { receiptUrl } });
    await prisma.raffleNumber.updateMany({
      where: { saleId: sale.id },
      data: { receiptUrl },
    });
  } catch (e) {
    console.warn("⚠️  Recibo omitido en el seed:", (e as Error).message);
  }

  console.log("✅ Seed completo:", {
    user: user.email,
    raffle: raffle.title,
    numeros: 50,
    tasaVES: 140,
    contacto: contact.name,
    ventaDemo: {
      numeros: ventaNumeros,
      total: totalVenta,
      abonado: abono,
      deuda,
      status: sale.status,
      receiptUrl: receiptUrl ?? "(omitido)",
    },
  });
}

main()
  .catch((e) => {
    console.error("❌ Seed falló:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
