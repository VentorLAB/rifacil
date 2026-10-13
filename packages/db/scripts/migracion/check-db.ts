/**
 * READ-ONLY fingerprint of a rifacil database, to tell which one is production
 * before the riffas.info migration (Paso 0 of docs/MIGRACION-RIFFAS-INFO.md).
 *
 *   npx tsx scripts/migracion/check-db.ts
 *
 * Prints: host, Orlando's account, the El Dubai #066 sale (the 11-oct receipt
 * test lives only in production), the most recent sale, sales per raffle and
 * pending migrations. Only SELECTs. Needs DATABASE_URL in the shell.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "../../src/generated";
import { hostOf } from "./lib/db-helpers";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in this shell");
  console.log(`[host] ${hostOf(url)}`);
  const prisma = new PrismaClient();
  try {
    const orlando = await prisma.user.findUnique({
      where: { email: "orlando.pernia@rifacil.vip" },
      select: { id: true, name: true, businessOwnerId: true },
    });
    console.log(`[orlando] ${orlando ? `${orlando.name} ${orlando.id} root=${!orlando.businessOwnerId}` : "NOT FOUND"}`);

    const n066 = await prisma.raffleNumber.findMany({
      where: { number: "066", raffle: { title: { contains: "Dubai", mode: "insensitive" } } },
      select: {
        status: true,
        raffle: { select: { id: true, title: true } },
        sale: { select: { receiptNumber: true, source: true, createdAt: true, amountPaid: true, contact: { select: { name: true } } } },
      },
    });
    for (const n of n066) {
      console.log(
        `[El Dubai #066] raffle=${n.raffle.id} status=${n.status} ` +
          (n.sale ? `sale=${n.sale.receiptNumber} src=${n.sale.source} ${n.sale.createdAt.toISOString()} $${n.sale.amountPaid} ${n.sale.contact.name}` : "no sale"),
      );
    }
    if (!n066.length) console.log("[El Dubai #066] no El Dubai raffle here");

    const last = await prisma.sale.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, source: true } });
    console.log(`[last sale] ${last ? `${last.createdAt.toISOString()} src=${last.source}` : "none"}`);

    const raffles = await prisma.raffle.findMany({
      select: { id: true, title: true, status: true, _count: { select: { sales: true } } },
      orderBy: { createdAt: "asc" },
    });
    for (const r of raffles) console.log(`[raffle] ${r.id} ${r.status.padEnd(7)} sales=${String(r._count.sales).padStart(4)}  ${r.title}`);

    const dir = resolve(__dirname, "../../prisma/migrations");
    const local = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
      .map((d) => d.name);
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const done = new Set(applied.map((a) => a.migration_name));
    const pending = local.filter((m) => !done.has(m));
    console.log(`[migrations] ${pending.length ? `PENDING: ${pending.join(", ")}` : "up to date"}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
