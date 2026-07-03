// QUIRÚRGICO: cambia SOLO el campo `status` de la rifa "El Marino" PAUSED → DRAWN.
// NO toca prize, description, precio, stock, números, winnerNumber ni ningún otro campo.
//
// Por qué por script y no por panel: el panel solo llega a DRAWN ejecutando un sorteo
// real (elige ganador entre números vendidos/pagados y setea winner/winnerNumber/drawnAt).
// Acá solo queremos marcar la rifa como sorteada para que salga en la galería de
// "Ganadores" del storefront (el front muestra el fallback "🎉 Ganador anunciado en
// nuestro Instagram" cuando no hay winnerNumber). Efecto en la landing:
//   - PAUSED hoy  → la rifa NO aparece en ningún lado (el query pide ACTIVE|DRAWN).
//   - DRAWN luego → aparece SOLO en la sección Ganadores, no en el listado activo.
//
// Seguridad: DRY RUN por defecto (imprime ANTES + lo que cambiaría, no escribe).
// Idempotente: si ya está DRAWN, no hace nada. Confirmá [host] = ep-billowing-bread (prod).
//
//   DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/set-elmarino-drawn.ts        # dry-run
//   APPLY=1 DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/set-elmarino-drawn.ts # aplicar
import { prisma } from "@riffas/db";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const RAFFLE_TITLE = "El Marino";
const APPLY = process.env.APPLY === "1";
const hostOf = (u?: string) => u?.match(/@([^/:?]+)/)?.[1] ?? "<sin host>";

(async () => {
  console.log(`[host] ${hostOf(process.env.DATABASE_URL)}  |  modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe)"}`);
  const u = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!u) { console.error("✖ Orlando no encontrado — aborto."); process.exit(1); }
  const r = await prisma.raffle.findFirst({
    where: { userId: u.id, title: RAFFLE_TITLE },
    select: { id: true, title: true, status: true, winnerNumber: true, isPublic: true },
  });
  if (!r) { console.error(`✖ Rifa "${RAFFLE_TITLE}" no encontrada — aborto.`); process.exit(1); }

  console.log(`\n── ANTES ──`);
  console.log(`  id:           ${r.id}`);
  console.log(`  title:        ${JSON.stringify(r.title)}`);
  console.log(`  status:       ${r.status}`);
  console.log(`  winnerNumber: ${r.winnerNumber ?? "(ninguno)"}`);
  console.log(`  isPublic:     ${r.isPublic}`);
  console.log(`\n── QUEDARÍA ──`);
  console.log(`  status:       DRAWN  (solo este campo)`);

  if (r.status === "DRAWN") {
    console.log(`\n✔ Ya está DRAWN — no hay nada que hacer (idempotente).`);
    await prisma.$disconnect();
    return;
  }
  if (r.status !== "PAUSED") {
    console.warn(`\n⚠ Estado actual es ${r.status}, no PAUSED. Revisá antes de aplicar.`);
  }

  if (!APPLY) {
    console.log(`\n(DRY RUN) No se escribió nada. Aplicar: APPLY=1 con la misma DATABASE_URL de prod.`);
    await prisma.$disconnect();
    return;
  }
  await prisma.raffle.update({ where: { id: r.id }, data: { status: "DRAWN" } });
  const after = await prisma.raffle.findUnique({ where: { id: r.id }, select: { status: true } });
  console.log(`\n✅ APPLY listo.  status: ${after?.status}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("❌ Error:", e); process.exit(1); });
