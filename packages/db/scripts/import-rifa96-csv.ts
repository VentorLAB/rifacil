import "./_env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated";

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────────────────
// Importa la rifa #96 (export de riffas.info) a rifacil:
//  - crea/empareja la rifa (1000 números 000–999, precio 55) bajo Orlando (negocio)
//  - por cada número ocupado: Contact (titular) + Sale (con abonado/adeudado) + link
//  - atribuye el vendedor: Orlando/Eduard = admins; Maria/Georgely = vendedoras
//  - respeta UNIQUE(raffleId, number). Idempotente: si la rifa existe, la reemplaza.
// ───────────────────────────────────────────────────────────────────────────

const RAFFLE_TITLE = "Rifa 96";
const PRICE = 55;
const CSV = process.argv[2] || resolve(__dirname, "rifa-96-import.csv");

const norm = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function mapStatus(estado: string): "PAID" | "RESERVED" | "AVAILABLE" {
  const v = norm(estado);
  if (v === "vendido") return "PAID";
  if (v === "apartado") return "RESERVED";
  return "AVAILABLE";
}

// Parser CSV con comillas (campos con coma dentro de comillas, p. ej. la fecha).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const ORLANDO = await prisma.user.findFirst({ where: { phone: "+584123863998" }, select: { id: true } });
  const EDUARD = await prisma.user.findFirst({ where: { phone: "+584147382696" }, select: { id: true } });
  if (!ORLANDO || !EDUARD) throw new Error("No encontré a Orlando/Eduard");
  const vendors = await prisma.vendor.findMany({ where: { userId: ORLANDO.id }, select: { id: true, name: true, lastName: true } });
  const maria = vendors.find((v) => norm(v.name).includes("maria") && norm(v.lastName || "").includes("rea"));
  const georgely = vendors.find((v) => norm(v.name).includes("georgely"));

  // Resuelve vendedor → atribución (contactOwner para privacidad de contactos, vendorId si aplica).
  function seller(label: string): { contactOwner: string; vendorId: string | null } {
    const v = norm(label);
    if (v.includes("eduar")) return { contactOwner: EDUARD!.id, vendorId: null };
    if (v.includes("maria") && maria) return { contactOwner: ORLANDO!.id, vendorId: maria.id };
    if ((v.includes("georgely") || v.includes("toledo")) && georgely) return { contactOwner: ORLANDO!.id, vendorId: georgely.id };
    return { contactOwner: ORLANDO!.id, vendorId: null }; // Orlando o desconocido → negocio
  }

  const raw = readFileSync(CSV, "utf8").replace(/^﻿/, "");
  const rows = parseCsv(raw).filter((r) => r.length >= 2 && r[0] !== "" && r[0] !== "numero");

  // 1) Reemplazo idempotente de la rifa.
  const existing = await prisma.raffle.findFirst({ where: { userId: ORLANDO.id, title: RAFFLE_TITLE }, select: { id: true } });
  if (existing) await prisma.raffle.delete({ where: { id: existing.id } }); // cascada a numbers/sales

  const raffle = await prisma.raffle.create({
    data: {
      userId: ORLANDO.id, title: RAFFLE_TITLE, prize: "Por definir (importada de riffas.info)",
      prizeValue: "0", pricePerNumber: String(PRICE), totalNumbers: rows.length,
      numberFormat: "000", startDate: new Date(), status: "ACTIVE", isPublic: true,
    },
  });

  // 2) Crear los 1000 números (todos AVAILABLE). UNIQUE(raffleId, number) garantizado.
  await prisma.raffleNumber.createMany({
    data: rows.map((r) => ({ raffleId: raffle.id, number: r[0] })),
    skipDuplicates: true,
  });

  // 3) Pre-crear contactos únicos (dedup por owner+phone) para evitar carreras.
  type Row = { number: string; status: "PAID" | "RESERVED" | "AVAILABLE"; name: string; phone: string; city: string; contactOwner: string; vendorId: string | null; paid: number; debt: number };
  const parsed: Row[] = [];
  const contactKey = new Map<string, { ownerId: string; phone: string; name: string; city: string }>();
  for (const r of rows) {
    const [numero, estado, nombre, apellido, telefono, direccion, vendedor, vAbon, vAdeu] = r;
    const status = mapStatus(estado);
    if (status === "AVAILABLE") { parsed.push({ number: numero, status, name: "", phone: "", city: "", contactOwner: "", vendorId: null, paid: 0, debt: 0 }); continue; }
    const { contactOwner, vendorId } = seller(vendedor);
    const phone = (telefono || "").trim() || `import96-${numero}`;
    const name = `${(nombre || "").trim()} ${(apellido || "").trim()}`.trim() || "Sin nombre";
    const key = `${contactOwner}|${phone}`;
    if (!contactKey.has(key)) contactKey.set(key, { ownerId: contactOwner, phone, name, city: (direccion || "").trim() });
    parsed.push({ number: numero, status, name, phone, city: (direccion || "").trim(), contactOwner, vendorId, paid: Number(vAbon) || 0, debt: Number(vAdeu) || 0 });
  }

  const contactId = new Map<string, string>();
  for (const [key, c] of contactKey) {
    const ct = await prisma.contact.upsert({
      where: { userId_phone: { userId: c.ownerId, phone: c.phone } },
      update: {},
      create: { userId: c.ownerId, name: c.name, phone: c.phone, city: c.city || null, source: "import-riffas-96", importedFrom: "riffas.info #96", importedAt: new Date() },
      select: { id: true },
    });
    contactId.set(key, ct.id);
  }

  // 4) Crear venta + pago + link por número ocupado (pool de concurrencia).
  const occupied = parsed.filter((p) => p.status !== "AVAILABLE");
  let revenue = 0;
  async function importOne(p: Row, i: number) {
    const finalAmount = Math.round((p.paid + p.debt) * 100) / 100 || PRICE;
    const isPaid = p.status === "PAID";
    const cId = contactId.get(`${p.contactOwner}|${p.phone}`)!;
    const receiptNumber = `R96-${p.number}`;
    const sale = await prisma.sale.create({
      data: {
        raffleId: raffle.id, contactId: cId, userId: ORLANDO!.id, vendorId: p.vendorId,
        numbers: [p.number], totalNumbers: 1, totalAmount: String(finalAmount), finalAmount: String(finalAmount),
        amountPaid: String(p.paid), status: isPaid ? "PAID" : "RESERVED",
        paidAt: isPaid ? new Date() : null, receiptNumber, source: "import",
      },
    });
    if (p.paid > 0) {
      await prisma.payment.create({ data: { saleId: sale.id, amount: String(p.paid), method: "EFECTIVO_USD", status: "CONFIRMED" } });
    }
    await prisma.raffleNumber.updateMany({
      where: { raffleId: raffle.id, number: p.number },
      data: { status: p.status, contactId: cId, saleId: sale.id, vendorId: p.vendorId, soldAt: new Date(), paidAt: isPaid ? new Date() : null, receiptNumber },
    });
    revenue += p.paid;
  }
  const POOL = 12;
  for (let i = 0; i < occupied.length; i += POOL) {
    await Promise.all(occupied.slice(i, i + POOL).map((p, k) => importOne(p, i + k)));
  }

  // 5) Stats + verificación de conteos desde la DB.
  await prisma.raffle.update({ where: { id: raffle.id }, data: { soldCount: occupied.length, revenue: String(Math.round(revenue * 100) / 100) } });
  const counts = await prisma.raffleNumber.groupBy({ by: ["status"], where: { raffleId: raffle.id }, _count: true });
  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count;
  const total = await prisma.raffleNumber.count({ where: { raffleId: raffle.id } });
  const contactsCreated = contactId.size;

  console.log(JSON.stringify({ raffleId: raffle.id, title: raffle.title, total, byStatus, contactsCreated, revenue: Math.round(revenue * 100) / 100 }, null, 2));
}

main().catch((e) => { console.error("❌ Import falló:", e); process.exit(1); }).finally(() => prisma.$disconnect());
