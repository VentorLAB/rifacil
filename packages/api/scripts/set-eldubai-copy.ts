// QUIRÚRGICO: setea SOLO el copy de texto de "El Dubai" → `prize` (gancho corto,
// tarjeta) y `description` (versión larga, página de la rifa). NO toca precio,
// stock, números, status ni ningún otro campo.
//
// Seguridad: DRY RUN por defecto (imprime ANTES + lo que cambiaría, no escribe).
// Aplicar: APPLY=1. Idempotente. Confirma [host] = ep-billowing-bread (prod).
//
//   DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/set-eldubai-copy.ts        # dry-run
//   APPLY=1 DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/set-eldubai-copy.ts # aplicar
import { prisma } from "@riffas/db";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const RAFFLE_TITLE = "El Dubai";
const APPLY = process.env.APPLY === "1";
const hostOf = (u?: string) => u?.match(/@([^/:?]+)/)?.[1] ?? "<sin host>";

// Copy aprobado por Orlando.
const PRIZE = "Toyota Agya 2026 0km + $1.500 en efectivo 🚗";
const DESCRIPTION =
  "🚗 Imagínate manejando tu Toyota Agya 2026 0km, y con $1.000 y $500 en efectivo extra en tu bolsillo. " +
  "Un solo número puede cambiarte el año. Jugamos con la Lotería del Táchira EN VIVO por Instagram, para que " +
  "veas con tus propios ojos que todo es transparente y real. Llevamos desde 2019 entregando premios de verdad. " +
  "Aparta tu número antes de que se agoten — quedan poquitos.";

(async () => {
  console.log(`[host] ${hostOf(process.env.DATABASE_URL)}  |  modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe)"}`);
  const u = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!u) { console.error("✖ Orlando no encontrado — aborto."); process.exit(1); }
  const r = await prisma.raffle.findFirst({ where: { userId: u.id, title: RAFFLE_TITLE }, select: { id: true, prize: true, description: true } });
  if (!r) { console.error(`✖ Rifa "${RAFFLE_TITLE}" no encontrada — aborto.`); process.exit(1); }

  console.log(`\n── ANTES ──`);
  console.log(`  prize:       ${JSON.stringify(r.prize)}`);
  console.log(`  description: ${JSON.stringify(r.description)}`);
  console.log(`\n── QUEDARÍA ──`);
  console.log(`  prize:       ${JSON.stringify(PRIZE)}`);
  console.log(`  description: ${JSON.stringify(DESCRIPTION)}`);

  if (!APPLY) {
    console.log(`\n(DRY RUN) No se escribió nada. Aplicar: APPLY=1 con la misma DATABASE_URL de prod.`);
    await prisma.$disconnect();
    return;
  }
  await prisma.raffle.update({ where: { id: r.id }, data: { prize: PRIZE, description: DESCRIPTION } });
  const after = await prisma.raffle.findUnique({ where: { id: r.id }, select: { prize: true, description: true } });
  console.log(`\n✅ APPLY listo.`);
  console.log(`  prize:       ${JSON.stringify(after?.prize)}`);
  console.log(`  description: ${JSON.stringify(after?.description)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("❌ Error:", e); process.exit(1); });
