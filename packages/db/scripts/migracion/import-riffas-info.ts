try { require("../_env"); } catch { /* dry-run sin .env: no hace falta DB */ }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, Prisma } from "../../src/generated";

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────────────────
// Importa el dump de riffas.info (export-riffas-info.mjs) a rifacil.
//
// SEGURO POR DEFECTO: sin --confirm solo hace DRY-RUN (reporte, cero escrituras).
// Escritura real requiere: --confirm MIGRAR --user-id <cuid del rifero destino>.
//
// Qué crea por rifa importada (idempotente: reemplaza rifas ya importadas del
// mismo origen vía id-map.json en el dump dir):
//   Raffle (DRAFT/ACTIVE/DRAWN según fecha y flag) + RaffleNumber (todos) +
//   Vendor (responsables→ADMIN, vendedores→VENDEDOR, dedup por cédula) +
//   Contact (dedup userId+phone) + Sale agrupada por cliente×rifa +
//   Payment por cada abono real (método mapeado, CONFIRMED).
//
// Estados: sold+sinDeuda→PAID, sold+deuda→SOLD, apartado/pending→RESERVED.
// Métodos: efectivo→EFECTIVO_USD (supuesto, ver --cash-method), Bancolombia→
// BANCOLOMBIA, Nequi→NEQUI, Zelle→ZELLE, Pago Móvil→PAGO_MOVIL, otro→CASH.
// ───────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CONFIRM = getArg("--confirm") === "MIGRAR";
const DRY = !CONFIRM;
const USER_ID = getArg("--user-id");
const DUMP_DIR = resolve(getArg("--dump") || "migration-dump");
const CASH_METHOD = (getArg("--cash-method") || "EFECTIVO_USD") as Prisma.PaymentCreateInput["method"];
const ONLY_RAFFLE = getArg("--raffle-id"); // limita a una rifa externa

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (n: number) => String(Math.max(0, n - 1)).length;

function mapPayMethod(name: string): { method: Prisma.PaymentCreateInput["method"]; note?: string } {
  const v = norm(name);
  if (v.includes("efectivo")) return { method: CASH_METHOD, note: `efectivo→${CASH_METHOD} (supuesto)` };
  if (v.includes("bancolombia")) return { method: "BANCOLOMBIA" };
  if (v.includes("nequi")) return { method: "NEQUI" };
  if (v.includes("zelle")) return { method: "ZELLE" };
  if (v.includes("pago movil")) return { method: "PAGO_MOVIL" };
  if (v.includes("binance")) return { method: "BINANCE" };
  if (v.includes("zinli")) return { method: "ZINLI" };
  if (v.includes("transfer")) return { method: "BANK_TRANSFER" };
  return { method: "CASH", note: `método desconocido "${name}"→CASH` };
}

async function main() {
  const dump = JSON.parse(readFileSync(resolve(DUMP_DIR, "riffas-info-dump.json"), "utf8"));
  const idMapPath = resolve(DUMP_DIR, "id-map.json");
  const idMap: Record<string, string> = existsSync(idMapPath) ? JSON.parse(readFileSync(idMapPath, "utf8")) : {};

  const report: any = { mode: DRY ? "DRY-RUN (sin escrituras)" : "MIGRACIÓN REAL", raffles: [], warnings: [] as string[] };

  let targetUser: { id: string } | null = null;
  if (!DRY) {
    if (!USER_ID) throw new Error("Falta --user-id (cuenta rifacil destino)");
    targetUser = await prisma.user.findUnique({ where: { id: USER_ID }, select: { id: true } });
    if (!targetUser) throw new Error(`Usuario ${USER_ID} no existe`);
  }

  const raffles = (dump.raffles as any[]).filter((r) => !ONLY_RAFFLE || String(r.id) === ONLY_RAFFLE);
  // Vendedores por rifa (assing-user). La fuente rica de ventas = clients.raffleNumbers.
  const clients = dump.clients as any[];

  for (const r of raffles) {
    const ext = String(r.id);
    const det = dump.raffleDetails?.[ext] || {};
    const detail = det.detail || r;
    const stats = detail.numbersByStatus || {};
    const price = Number(detail.price || r.price || 0);
    const nums = (dump.numbers?.[ext] || []) as any[];

    // Ventas reales desde clientes (tienen pagos con monto/método y deuda).
    const salesByClient = new Map<string, { client: any; numbers: any[] }>();
    for (const c of clients) {
      const mine = (c.raffleNumbers || []).filter((n: any) => String(n.raffleId) === ext);
      if (mine.length) salesByClient.set(String(c.id), { client: c, numbers: mine });
    }

    // Métodos de pago de ESTA rifa (id → nombre).
    const pmMap = new Map<number, string>();
    for (const pm of det.paymethods || []) pmMap.set(pm.id, pm.payMethode?.name || "?");

    // Vendedores de esta rifa.
    const vendorRows = (det.vendors || []) as any[];

    const covered = new Set<number>();
    for (const { numbers } of Array.from(salesByClient.values())) for (const n of numbers) covered.add(Number(n.number));
    const fallback = nums.filter((n: any) => n.status !== "available" && n.firstName && !covered.has(Number(n.number)));
    const soldNums = (salesByClient.size ? Array.from(salesByClient.values()).reduce((a, s) => a + s.numbers.length, 0) : 0) + fallback.length;
    let totalRecaudo = 0, totalDeuda = 0;
    const methodHist: Record<string, number> = {};
    for (const { numbers } of Array.from(salesByClient.values())) {
      for (const n of numbers) {
        totalDeuda += Number(n.paymentDue || 0);
        for (const p of n.payments || []) {
          if (Number(p.amount) > 0) {
            totalRecaudo += Number(p.amount);
            const name = pmMap.get(p.paymentMethodId) || "?";
            methodHist[name] = (methodHist[name] || 0) + 1;
          }
        }
      }
    }

    const available = Number(stats.available ?? 0);
    const isPast = !!detail.playDate && new Date(detail.playDate) < new Date() && available === 0;
    const rReport: any = {
      rifaExterna: ext, nombre: detail.name || r.name, precio: price,
      numerosTablero: nums.length || detail.totalNumbers,
      estadosTablero: stats, ventasClientes: salesByClient.size, numerosVendidos: soldNums,
      recaudoEsperado: Math.round(totalRecaudo * 100) / 100, deudaEsperada: Math.round(totalDeuda * 100) / 100,
      recaudoSegunApp: det.recaudo, metodosPago: methodHist,
      ventasFallbackSinCliente: fallback.length,
      estadoDestino: isPast ? "DRAWN" : "ACTIVE", vendedores: vendorRows.length,
    };
    report.raffles.push(rReport);

    if (fallback.length) report.warnings.push(`Rifa ${ext}: ${fallback.length} números vendidos sin ficha de cliente — se importan con contacto solo-nombre y pago asumido (revisar).`);
    if (det.recaudo && Math.abs(Number(det.recaudo.totalRecaudado) - totalRecaudo) > 1) {
      report.warnings.push(`Rifa ${ext}: recaudo de clientes (${totalRecaudo.toFixed(2)}) ≠ recaudo app (${det.recaudo.totalRecaudado}) — revisar pagos no ligados a cliente.`);
    }

    if (DRY) continue;

    // ─── Escritura real ───
    const uid = targetUser!.id;

    // Vendedores: dedup por cédula.
    const vendorIdByExt = new Map<string, string>();
    for (const v of vendorRows) {
      const u = v.user || {};
      const doc = String(u.identificationNumber || "");
      let ven = doc ? await prisma.vendor.findFirst({ where: { userId: uid, idDocument: doc }, select: { id: true } }) : null;
      if (!ven) {
        ven = await prisma.vendor.create({
          data: {
            userId: uid, name: u.firstName || "Vendedor", lastName: u.lastName || null,
            idDocument: doc || null, phone: String(u.phone || ""), code: `IMP${ext}-${u.id}`,
            role: v.role === "responsable" ? "ADMIN" : "VENDEDOR",
          },
          select: { id: true },
        });
      }
      vendorIdByExt.set(String(u.id), ven.id);
    }

    // Rifa: reemplazo idempotente por id-map o por título+origen.
    const prevId = idMap[ext];
    if (prevId) await prisma.raffle.delete({ where: { id: prevId } }).catch(() => {});
    const prizes = String(detail.description || "").split("||").map((s: string) => s.trim()).filter(Boolean);
    const raffle = await prisma.raffle.create({
      data: {
        userId: uid, title: detail.name || r.name, description: detail.description || null,
        prize: prizes[0] || "Premio importado de riffas.info", prizeValue: "0",
        representanteLegal: detail.nameResponsable || null, representanteCedula: detail.nitResponsable || null,
        loteria: detail.loteria || null, contactWhatsapp: detail.contactRifero || null,
        color: detail.color || "#7c3aed", bannerUrl: detail.banerImgUrl || null, bannerMobileUrl: detail.banerMovileImgUrl || null,
        pricePerNumber: String(price), totalNumbers: detail.totalNumbers || nums.length,
        numberFormat: "0".repeat(Math.max(3, digits(detail.totalNumbers || 1000))),
        startDate: detail.startDate ? new Date(detail.startDate) : new Date(),
        drawDate: detail.playDate ? new Date(detail.playDate) : null,
        status: isPast ? "DRAWN" : "ACTIVE", isPublic: !isPast,
      },
    });
    idMap[ext] = raffle.id;

    // Todos los números AVAILABLE de una vez.
    const total = detail.totalNumbers || nums.length;
    const fmt = (i: number) => String(i).padStart(Math.max(3, digits(total)), "0");
    await prisma.raffleNumber.createMany({
      data: Array.from({ length: total }, (_, i) => ({ raffleId: raffle.id, number: fmt(i) })),
      skipDuplicates: true,
    });

    // Ventas agrupadas por cliente.
    let revenue = 0, soldCount = 0;
    for (const [cId, { client, numbers }] of Array.from(salesByClient)) {
      const phone = String(client.phone || "").trim() || `import-${ext}-${cId}`;
      const name = `${client.firstName || ""} ${client.lastName || ""}`.trim() || "Sin nombre";
      const ct = await prisma.contact.upsert({
        where: { userId_phone: { userId: uid, phone } },
        update: {},
        create: { userId: uid, name, phone, city: String(client.address || "").trim() || null, source: "import", importedFrom: `riffas.info #${ext}`, importedAt: new Date() },
        select: { id: true },
      });

      const totalAmount = numbers.reduce((a: number, n: any) => a + (Number(n.paymentAmount) || price), 0);
      const realPays = numbers.flatMap((n: any) => (n.payments || []).filter((p: any) => Number(p.amount) > 0));
      const amountPaid = realPays.reduce((a: number, p: any) => a + Number(p.amount), 0);
      const isPaid = amountPaid >= totalAmount - 0.005;
      const firstPay = realPays[0];
      const vendorId = firstPay && vendorIdByExt.get(String(numbers[0].payments?.[0]?.userId)) || null;
      const receiptNumber = `IMP${ext}-${cId}`;

      const sale = await prisma.sale.create({
        data: {
          raffleId: raffle.id, contactId: ct.id, userId: uid, vendorId,
          numbers: numbers.map((n: any) => fmt(n.number)), totalNumbers: numbers.length,
          totalAmount: String(totalAmount), finalAmount: String(totalAmount), amountPaid: String(amountPaid),
          status: isPaid ? "PAID" : "RESERVED", paidAt: isPaid ? new Date() : null,
          receiptNumber, source: "import",
        },
      });
      for (const p of realPays) {
        const { method, note } = mapPayMethod(pmMap.get(p.paymentMethodId) || "?");
        if (note) report.warnings.push(`Rifa ${ext} venta ${receiptNumber}: ${note}`);
        await prisma.payment.create({ data: { saleId: sale.id, amount: String(p.amount), method, status: "CONFIRMED", createdAt: p.createdAt ? new Date(p.createdAt) : new Date() } });
      }
      for (const n of numbers) {
        const st = isPaid ? "PAID" : Number(n.paymentDue) < (Number(n.paymentAmount) || price) ? "SOLD" : "RESERVED";
        await prisma.raffleNumber.updateMany({
          where: { raffleId: raffle.id, number: fmt(n.number) },
          data: { status: st, contactId: ct.id, saleId: sale.id, vendorId, soldAt: new Date(), paidAt: isPaid ? new Date() : null, receiptNumber },
        });
        soldCount++;
      }
      revenue += amountPaid;
    }

    // Fallback: vendidos sin ficha de cliente (nombre del tablero, pago asumido).
    for (const n of fallback) {
      const num = fmt(Number(n.number));
      const nm = `${n.firstName || ""} ${n.lastName || ""}`.trim() || "Sin nombre";
      const phone = `import-${ext}-${num}`;
      const ct = await prisma.contact.upsert({
        where: { userId_phone: { userId: uid, phone } },
        update: {},
        create: { userId: uid, name: nm, phone, source: "import", importedFrom: `riffas.info #${ext} (tablero)`, importedAt: new Date() },
        select: { id: true },
      });
      const amount = Number(n.paymentAmount) || price;
      const paid = n.status === "sold";
      const receiptNumber = `IMP${ext}-T${num}`;
      const sale = await prisma.sale.create({
        data: {
          raffleId: raffle.id, contactId: ct.id, userId: uid,
          numbers: [num], totalNumbers: 1, totalAmount: String(amount), finalAmount: String(amount),
          amountPaid: paid ? String(amount) : "0", status: paid ? "PAID" : "RESERVED",
          paidAt: paid ? new Date() : null, receiptNumber, source: "import",
        },
      });
      if (paid) await prisma.payment.create({ data: { saleId: sale.id, amount: String(amount), method: CASH_METHOD, status: "CONFIRMED" } });
      await prisma.raffleNumber.updateMany({
        where: { raffleId: raffle.id, number: num },
        data: { status: paid ? "PAID" : "RESERVED", contactId: ct.id, saleId: sale.id, soldAt: new Date(), paidAt: paid ? new Date() : null, receiptNumber },
      });
      soldCount++; revenue += paid ? amount : 0;
    }

    await prisma.raffle.update({ where: { id: raffle.id }, data: { soldCount, revenue: String(Math.round(revenue * 100) / 100) } });
    rReport.rifaDestino = raffle.id;
    writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(() => prisma.$disconnect());
