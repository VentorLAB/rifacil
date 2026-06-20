import "./_env"; // PRIMERO: puebla process.env (DATABASE_URL, etc.) antes de instanciar Prisma
import { PrismaClient } from "../src/generated";
import { normalizePhone } from "../../shared/src/phone";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────────────────
// Crea/actualiza (idempotente):
//   - 2 RIFEROS (User, login NextAuth: teléfono + contraseña, bcrypt 12)
//   - 2 VENDEDORES (Vendor bajo Orlando, login portal: teléfono + accessCode)
// Re-ejecutable: upsert por teléfono (User) y por (userId, phone) (Vendor).
// ───────────────────────────────────────────────────────────────────────────

const PASSWORD = "Rifacil2026";

// Código de acceso corto y legible (PIN del vendedor), sin caracteres ambiguos.
function genAccessCode(len = 6): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function genUniqueVendorCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = `VEN-${genAccessCode(5)}`;
    const exists = await prisma.vendor.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error("No se pudo generar un code de vendedor único");
}

function mustNormalize(raw: string): string {
  const p = normalizePhone(raw, "VE");
  if (!p) throw new Error(`Teléfono no normalizable: ${raw}`);
  return p;
}

async function upsertRifero(opts: {
  rawPhone: string;
  name: string;
  email: string;
}) {
  const phone = mustNormalize(opts.rawPhone);
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { phone },
    update: { passwordHash, name: opts.name, email: opts.email, role: "RIFERO" },
    create: {
      phone,
      email: opts.email,
      name: opts.name,
      passwordHash,
      role: "RIFERO",
      onboardingCompleted: true,
      settings: {
        create: {
          currency: "USD",
          language: "es",
          timezone: "America/Caracas",
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

  // Garantiza settings + subscription aunque el User ya existiera de antes.
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, currency: "USD", language: "es", timezone: "America/Caracas" },
  });
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      plan: "PRO",
      status: "ACTIVE",
      maxRaffles: 100,
      maxContacts: 100_000,
      maxVendors: 50,
      maxNumbers: 100_000,
      maxCampaignsPerMonth: 1000,
    },
  });

  return { id: user.id, phone, email: user.email, role: user.role, name: user.name };
}

async function upsertVendor(opts: {
  ownerUserId: string;
  rawPhone: string;
  name: string;
  lastName: string;
  idDocument: string;
  email: string;
}) {
  const phone = mustNormalize(opts.rawPhone);

  const existing = await prisma.vendor.findFirst({
    where: { userId: opts.ownerUserId, phone },
  });

  if (existing) {
    const updated = await prisma.vendor.update({
      where: { id: existing.id },
      data: {
        name: opts.name,
        lastName: opts.lastName,
        idDocument: opts.idDocument,
        email: opts.email,
        role: "VENDEDOR",
        active: true,
        accessCode: existing.accessCode ?? genAccessCode(),
      },
    });
    return {
      id: updated.id,
      phone,
      code: updated.code,
      accessCode: updated.accessCode,
      role: updated.role,
      reused: true,
    };
  }

  const code = await genUniqueVendorCode();
  const accessCode = genAccessCode();
  const created = await prisma.vendor.create({
    data: {
      userId: opts.ownerUserId,
      name: opts.name,
      lastName: opts.lastName,
      idDocument: opts.idDocument,
      phone,
      email: opts.email,
      code,
      accessCode,
      role: "VENDEDOR",
      active: true,
    },
  });
  return { id: created.id, phone, code, accessCode, role: created.role, reused: false };
}

async function main() {
  // 1) RIFEROS (rol admin del negocio → User RIFERO, dueños del tenant)
  const orlando = await upsertRifero({
    rawPhone: "04123863998", // 0412-3863998 → +584123863998
    name: "Orlando Pernia",
    email: "orlando.pernia@rifacil.vip",
  });
  const eduard = await upsertRifero({
    rawPhone: "04147382696", // 0414-7382696 → +584147382696
    name: "Eduard Pernia",
    email: "eduard.pernia@rifacil.vip",
  });

  // 2) VENDEDORES (bajo Orlando)
  const maria = await upsertVendor({
    ownerUserId: orlando.id,
    rawPhone: "04247843616", // → +584247843616
    name: "Maria",
    lastName: "Reaño",
    idDocument: "9352718",
    email: "Maria.riano718@gmail.com",
  });
  const georgely = await upsertVendor({
    ownerUserId: orlando.id,
    rawPhone: "4247376999", // local sin 0 → +584247376999
    name: "Georgely",
    lastName: "Toledo",
    idDocument: "25496377",
    email: "Georgelytoledo@gmail.com",
  });

  console.log("\n✅ RIFEROS (login: teléfono + contraseña):");
  console.table([
    { ...orlando, password: PASSWORD },
    { ...eduard, password: PASSWORD },
  ]);
  console.log("\n✅ VENDEDORES (login portal: teléfono + accessCode), bajo Orlando:");
  console.table([
    { name: "Maria Reaño", ...maria },
    { name: "Georgely Toledo", ...georgely },
  ]);
  console.log(
    "\nℹ️  No existe flag de 'cambiar contraseña al primer ingreso' en el schema; los riferos pueden usar /ajustes → cambiar contraseña."
  );
}

main()
  .catch((e) => {
    console.error("❌ Falló la creación:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
