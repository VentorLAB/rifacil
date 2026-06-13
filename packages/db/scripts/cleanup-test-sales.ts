/**
 * Limpia ventas de prueba (source = "test-script") y libera sus números.
 *   pnpm --filter @riffas/db exec tsx scripts/cleanup-test-sales.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src";

function loadRootEnv() {
  const raw = readFileSync(resolve(__dirname, "../../../.env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1] === "CLOUDINARY_URL") continue;
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

async function main() {
  loadRootEnv();
  const sales = await prisma.sale.findMany({ where: { source: "test-script" } });
  for (const s of sales) {
    await prisma.raffleNumber.updateMany({
      where: { saleId: s.id },
      data: {
        status: "AVAILABLE",
        saleId: null,
        contactId: null,
        soldAt: null,
        receiptNumber: null,
        receiptUrl: null,
      },
    });
    await prisma.sale.delete({ where: { id: s.id } });
  }
  console.log(`🧹 Limpiadas ${sales.length} venta(s) de prueba.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
