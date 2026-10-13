/**
 * Database helpers shared by the riffas.info importers
 * (import-riffas-info.ts and packages/api/scripts/import-eldubai-v1.ts).
 */
import type { Prisma } from "../../../src/generated";

type Tx = Prisma.TransactionClient;

/** Host part of a connection string, for the "which database am I writing to" guard. */
export const hostOf = (url?: string | null) => url?.match(/@([^/:?]+)/)?.[1] ?? "<no host>";

/**
 * Refuses a real write unless the operator typed the exact host they expect.
 * Without this, a missing DATABASE_URL in the shell silently falls back to
 * whatever the tooling loads (the local .env points at the DEV database).
 */
export function assertExpectedHost(expected: string | null | undefined, url: string | undefined): string {
  const host = hostOf(url);
  if (!url) throw new Error("DATABASE_URL is not set in this shell: refusing to guess the database");
  if (!expected) throw new Error(`real run needs --expect-host ${host} (or EXPECT_HOST) to confirm the target database`);
  if (expected.trim() !== host) throw new Error(`--expect-host "${expected}" does not match DATABASE_URL host "${host}"`);
  return host;
}

/**
 * Recomputes the denormalized CRM metrics of the given contacts from their real
 * sales (cancelled ones excluded): totalSpent, totalTickets, totalRaffles,
 * firstPurchase, lastPurchase. Imports bypass the sale router, which is what
 * normally keeps these up to date.
 */
export async function recomputeContactMetrics(tx: Tx, contactIds: string[]): Promise<void> {
  if (!contactIds.length) return;
  await tx.$executeRaw`
    UPDATE "Contact" c SET
      "totalSpent"    = s.spent,
      "totalTickets"  = s.tickets,
      "totalRaffles"  = s.raffles,
      "firstPurchase" = s.first,
      "lastPurchase"  = s.last
    FROM (
      SELECT c2.id,
             COALESCE(SUM(sa."amountPaid"), 0)        AS spent,
             COALESCE(SUM(sa."totalNumbers"), 0)::int AS tickets,
             COUNT(DISTINCT sa."raffleId")::int       AS raffles,
             MIN(sa."createdAt")                      AS first,
             MAX(sa."createdAt")                      AS last
      FROM "Contact" c2
      LEFT JOIN "Sale" sa ON sa."contactId" = c2.id AND sa.status <> 'CANCELLED'
      WHERE c2.id = ANY(${contactIds}::text[])
      GROUP BY c2.id
    ) s
    WHERE c.id = s.id`;
}

/** soldCount = occupied numbers; revenue = abonado of non-cancelled sales. */
export async function recomputeRaffleStats(tx: Tx, raffleId: string): Promise<{ soldCount: number; revenue: number; debt: number }> {
  const soldCount = await tx.raffleNumber.count({ where: { raffleId, status: { not: "AVAILABLE" } } });
  const agg = await tx.sale.aggregate({
    where: { raffleId, status: { not: "CANCELLED" } },
    _sum: { amountPaid: true, finalAmount: true },
  });
  const revenue = Math.round(Number(agg._sum.amountPaid ?? 0) * 100) / 100;
  const debt = Math.round((Number(agg._sum.finalAmount ?? 0) - revenue) * 100) / 100;
  await tx.raffle.update({ where: { id: raffleId }, data: { soldCount, revenue: String(revenue) } });
  return { soldCount, revenue, debt };
}

/** Number status counts of a raffle. */
export async function countByStatus(tx: Tx, raffleId: string): Promise<Record<string, number>> {
  const rows = await tx.raffleNumber.groupBy({ by: ["status"], where: { raffleId }, _count: { _all: true } });
  const out: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, PAID: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
