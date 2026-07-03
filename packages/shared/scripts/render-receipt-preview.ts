/**
 * Render LOCAL del recibo (sin DB ni Cloudinary) para revisar la UX.
 *   corepack pnpm --filter @riffas/shared exec tsx scripts/render-receipt-preview.ts
 * Genera dos PNG en el scratchpad: abono parcial y pagado completo.
 */
import { writeFileSync } from "fs";
import { renderReceiptPng } from "../src/receipt";

const OUT = process.env.OUT_DIR || ".";

async function one(name: string, overrides: any) {
  const base = {
    sale: {
      receiptNumber: "RF-ELDUBAI-00427",
      numbers: ["0427", "1188", "3902"],
      totalNumbers: 3,
      totalAmount: 9,
      finalAmount: 9,
      amountPaid: 9,
      rateUsed: 145.32,
      paymentMethod: "PAGO_MOVIL",
      createdAt: new Date("2026-06-27T15:30:00Z"),
      ...overrides.sale,
    },
    raffle: {
      title: "El Dubai",
      lottery: "Lotería del Táchira",
      drawDate: new Date("2026-07-15T20:00:00Z"),
      prize: "Toyota Agya 2026",
      prizeTagline: "Bello Toyota Agya 2026 GR + $1.500",
      bannerUrl: null,
      totalNumbers: 10000,
      remaining: 1840,
      pricePerNumber: 3,
      discountPackages: [
        { qty: 5, discountPercent: 10 },
        { qty: 10, discountPercent: 20 },
      ],
      ...overrides.raffle,
    },
    contact: { name: "María Pérez", phone: "+584241234567", city: "San Cristóbal" },
    brandName: "Grandes Rifas Hermanos Pernía",
    brandLogo: null,
    brandColor: "#e2001a",
    brandInstagram: "@rifashermanospernia",
    brandWebsite: "rifashermanospernia.com",
  };
  const png = await renderReceiptPng(base as any);
  const path = `${OUT}/${name}.png`;
  writeFileSync(path, png);
  console.log(`✓ ${path} (${(png.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  await one("receipt-pagado", {});
  await one("receipt-abono", {
    sale: { amountPaid: 4, finalAmount: 9, totalAmount: 9 },
  });
  await one("receipt-poco-vendido", {
    raffle: { remaining: 9200 },
    sale: { amountPaid: 9 },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
