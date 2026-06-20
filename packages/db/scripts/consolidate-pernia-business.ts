import "./_env";
import { PrismaClient } from "../src/generated";

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────────────────
// Consolida el negocio Pernía en UNA cuenta (Orlando), porque la app es
// mono-tenant por usuario. Mueve la rifa El Dubái (+ ventas + contactos) de
// Eduard → Orlando, y siembra los métodos de pago del negocio en Orlando.
// Idempotente: re-ejecutable sin duplicar.
// ───────────────────────────────────────────────────────────────────────────

const ORLANDO = "cmqg5sisi0000sz3bc27a4u9y";
const EDUARD = "cmqg5snwh0007sz3btkyq2o7q";
const RAFFLE = "cmqgsj78v0001146vl3cpxbwv"; // El Dubái

// Métodos de pago del negocio (de la imagen). active=true.
const PAYMENT_ACCOUNTS = [
  {
    method: "ZELLE",
    email: "agropecuariagyd@gmail.com",
    holderName: "Delcy Zambrano",
    note: "NO COLOCAR PAGOS DE RIFAS NI NADA EN CONCEPTO. PASAR CAPTURE CON EL NOMBRE.",
  },
  {
    method: "BANCOLOMBIA",
    holderName: "Georgely Toledo",
    accountNumber: "820-741160-07",
    idDocument: "1.127.664.184",
    note: "Cuenta de ahorros.",
  },
  {
    method: "BINANCE",
    email: "eduardpernia31@gmail.com",
  },
  {
    method: "PAGO_MOVIL",
    bankName: "0102 - Banco Provincial",
    phone: "0424-7376999",
    holderName: "Orlando Pernia",
    idDocument: "21.180.135",
  },
  {
    method: "ZINLI",
    email: "eduardpernia31@gmail.com",
  },
] as const;

async function main() {
  // 1) Mover la rifa + ventas + contactos de Eduard → Orlando (transacción).
  const moved = await prisma.$transaction(async (tx) => {
    const raffle = await tx.raffle.updateMany({
      where: { id: RAFFLE, userId: EDUARD },
      data: { userId: ORLANDO },
    });
    const sales = await tx.sale.updateMany({
      where: { raffleId: RAFFLE, userId: EDUARD },
      data: { userId: ORLANDO },
    });
    // Contactos que compraron en esta rifa (los únicos de Eduard).
    const contactIds = (
      await tx.sale.findMany({ where: { raffleId: RAFFLE }, select: { contactId: true } })
    ).map((s) => s.contactId);
    const contacts = await tx.contact.updateMany({
      where: { id: { in: contactIds }, userId: EDUARD },
      data: { userId: ORLANDO },
    });
    return { raffle: raffle.count, sales: sales.count, contacts: contacts.count };
  });

  // 2) Sembrar métodos de pago en Orlando (upsert por (userId, method)).
  const accounts: any[] = [];
  for (const a of PAYMENT_ACCOUNTS) {
    const { method, ...fields } = a as any;
    const data = {
      active: true,
      bankName: fields.bankName ?? null,
      phone: fields.phone ?? null,
      idDocument: fields.idDocument ?? null,
      email: fields.email ?? null,
      wallet: fields.wallet ?? null,
      holderName: fields.holderName ?? null,
      accountNumber: fields.accountNumber ?? null,
      note: fields.note ?? null,
    };
    const acc = await prisma.paymentAccount.upsert({
      where: { userId_method: { userId: ORLANDO, method } },
      update: data,
      create: { userId: ORLANDO, method, ...data },
    });
    accounts.push({ method: acc.method, holder: acc.holderName, active: acc.active });
  }

  // 3) Reporte de estado final.
  const orlandoRaffles = await prisma.raffle.count({ where: { userId: ORLANDO } });
  const orlandoVendors = await prisma.vendor.findMany({
    where: { userId: ORLANDO },
    select: { name: true, lastName: true, role: true, active: true },
  });
  const eduardLeftovers = {
    raffles: await prisma.raffle.count({ where: { userId: EDUARD } }),
    sales: await prisma.sale.count({ where: { userId: EDUARD } }),
    contacts: await prisma.contact.count({ where: { userId: EDUARD } }),
  };

  console.log(JSON.stringify({ moved, accounts, orlandoRaffles, orlandoVendors, eduardLeftovers }, null, 2));
}

main()
  .catch((e) => {
    console.error("❌ Falló la consolidación:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
