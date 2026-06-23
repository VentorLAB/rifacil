// QUIRÚRGICO: actualiza ÚNICAMENTE las 3 URLs de imagen (bannerUrl,
// bannerMobileUrl, iconUrl) de las rifas de Orlando Pernía. NO toca precio,
// stock, status, premios, packs, números vendidos ni ningún otro campo.
//
// Fuente de las URLs: backend v1 (riffas.info), verificadas HTTP 200 una por una.
//
// Seguridad:
//   - DRY RUN por defecto: imprime ANTES y el cambio propuesto, NO escribe.
//   - Para escribir de verdad: APPLY=1 (imprime ANTES → escribe → DESPUÉS).
//   - Sólo hace prisma.raffle.update con data = { bannerUrl, bannerMobileUrl, iconUrl }.
//   - Match por (userId, title). Si una rifa no existe, AVISA y la salta (no crea nada).
//
// Uso:
//   # ver qué haría (sin escribir):
//   DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/fix-banner-urls.ts
//   # aplicar:
//   APPLY=1 DATABASE_URL=<prod> DIRECT_URL=<prod> tsx scripts/fix-banner-urls.ts
import { prisma } from "@riffas/db";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const APPLY = process.env.APPLY === "1";
function host(u?: string) { return u?.match(/@([^/:?]+)/)?.[1] ?? "<sin host>"; }

// title (v2) → 3 URLs. SOLO estas 3 claves se escriben.
type Img = { bannerUrl: string; bannerMobileUrl: string; iconUrl: string };
const IMAGES: Record<string, Img> = {
  "El Dubai": {
    bannerUrl:       "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1779209875/pxfvi0cxiaswhyabnnox.jpg",
    bannerMobileUrl: "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1779209933/wdqhjk54mwroqhhjrobw.jpg",
    iconUrl:         "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1779209844/mu5bowenv8cljx5hpiha.jpg",
  },
  "Gran Rifa Resuelve": {
    bannerUrl:       "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1776862259/n7awwoek3tindh4uinyi.jpg",
    bannerMobileUrl: "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1776865366/ep75nf01gvsaxznwpl7w.jpg",
    iconUrl:         "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1776865374/fpvrn1nvvdxc6jcgwnkf.jpg",
  },
  "El Azulejo": {
    bannerUrl:       "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1772976263/bwlquhdwwrwwkfhz0hbj.jpg",
    bannerMobileUrl: "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1772975942/ijrzbq25dmrpvdcawtqx.jpg",
    iconUrl:         "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1772976510/ywtsbnnxpl81t29jotmu.jpg",
  },
  "El Marino": {
    bannerUrl:       "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1769714511/wghrajnlrhotocwgbi7x.jpg",
    bannerMobileUrl: "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1769714542/mvmnundri97mosbbplmh.jpg",
    iconUrl:         "https://res.cloudinary.com/dfbwjrpdu/image/upload/v1769716973/tmr5trm8w22mjtzyv381.png",
  },
};

const has = (v: string | null | undefined) => (v ? "✓" : "∅");

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}  |  modo: ${APPLY ? "APPLY (escribe)" : "DRY RUN (no escribe)"}`);

  const u = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!u) { console.error("✖ Orlando no encontrado — aborto."); process.exit(1); }
  const userId = u.id;

  const titles = Object.keys(IMAGES);
  const before = await prisma.raffle.findMany({
    where: { userId, title: { in: titles } },
    select: { id: true, title: true, bannerUrl: true, bannerMobileUrl: true, iconUrl: true },
  });
  const byTitle = new Map(before.map((r) => [r.title, r]));

  // ── ANTES ──
  const withBannerBefore = before.filter((r) => r.bannerUrl).length;
  console.log(`\n── ANTES ──  (rifas con bannerUrl: ${withBannerBefore}/${before.length} encontradas de ${titles.length} esperadas)`);
  for (const t of titles) {
    const r = byTitle.get(t);
    if (!r) { console.log(`  ⚠️  "${t}" NO existe en esta DB → se saltará`); continue; }
    console.log(`  ${t.padEnd(22)} banner=${has(r.bannerUrl)} mobile=${has(r.bannerMobileUrl)} icon=${has(r.iconUrl)}`);
  }

  // ── CAMBIO ──
  let updated = 0;
  for (const t of titles) {
    const r = byTitle.get(t);
    if (!r) continue;
    const data = IMAGES[t]; // EXACTAMENTE 3 claves: bannerUrl, bannerMobileUrl, iconUrl
    if (APPLY) {
      await prisma.raffle.update({ where: { id: r.id }, data });
      updated++;
    }
  }

  // ── DESPUÉS ──
  if (APPLY) {
    const after = await prisma.raffle.findMany({
      where: { userId, title: { in: titles } },
      select: { title: true, bannerUrl: true, bannerMobileUrl: true, iconUrl: true },
    });
    const withBannerAfter = after.filter((r) => r.bannerUrl).length;
    console.log(`\n── DESPUÉS ──  (rifas con bannerUrl: ${withBannerAfter}/${after.length})  ·  actualizadas: ${updated}`);
    for (const r of after) {
      console.log(`  ${r.title.padEnd(22)} banner=${has(r.bannerUrl)} mobile=${has(r.bannerMobileUrl)} icon=${has(r.iconUrl)}`);
    }
    console.log(withBannerAfter === after.length ? "\n✅ Todas las rifas encontradas quedaron con sus 3 URLs." : "\n⚠️  Revisar: alguna quedó sin banner.");
  } else {
    console.log(`\n(DRY RUN) Se actualizarían ${before.length} rifa(s), SOLO bannerUrl/bannerMobileUrl/iconUrl.`);
    console.log("Para aplicar: volvé a correr con APPLY=1 y la misma DATABASE_URL/DIRECT_URL de prod.");
  }

  await prisma.$disconnect();
})();
