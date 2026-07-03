// Corrige el Instagram de Orlando (Hermanos Pernía) en storefrontConfig:
// instagramHandle -> "@rifashermanospernia" (sin "2023"). Afecta el recibo
// (brandFor lee instagramHandle) y el pie de la tienda de marca.
//
// SEGURO POR DEFECTO: DRY-RUN salvo APPLY=1. Preserva el resto del JSON
// (spread): solo toca instagramHandle (y, si SET_URL=1, también la URL instagram).
// Idempotente.
//
// Uso (PROD): cargar DATABASE_URL/DIRECT_URL de prod y correr:
//   pnpm --filter @riffas/db exec tsx scripts/set-pernia-instagram.ts          # dry-run
//   APPLY=1 pnpm --filter @riffas/db exec tsx scripts/set-pernia-instagram.ts  # escribe
//   SET_URL=1 APPLY=1 ...   # además alinea la URL a instagram.com/rifashermanospernia
import { prisma } from "../src";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const NEW_HANDLE = "@rifashermanospernia";
const NEW_URL = "https://www.instagram.com/rifashermanospernia";
const APPLY = process.env.APPLY === "1";
const SET_URL = process.env.SET_URL === "1";

function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}  | modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}`);

  const u = await prisma.user.findUnique({
    where: { email: ORLANDO_EMAIL },
    select: { id: true, storefrontConfig: true },
  });
  if (!u) { console.error("Orlando no encontrado"); process.exit(1); }

  const cfg = (u.storefrontConfig ?? {}) as Record<string, any>;
  console.log("[antes] instagramHandle =", JSON.stringify(cfg.instagramHandle ?? null), "| instagram(URL) =", JSON.stringify(cfg.instagram ?? null));

  const next: Record<string, any> = { ...cfg, instagramHandle: NEW_HANDLE };
  if (SET_URL) next.instagram = NEW_URL;

  console.log("[después] instagramHandle =", JSON.stringify(next.instagramHandle), "| instagram(URL) =", JSON.stringify(next.instagram ?? null), SET_URL ? "" : "(URL sin tocar; usá SET_URL=1 para alinearla)");

  if (!APPLY) {
    console.log("DRY-RUN: no se escribió nada. Repetí con APPLY=1 para ejecutar.");
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({ where: { id: u.id }, data: { storefrontConfig: next as any } });
  console.log("✅ OK: storefrontConfig actualizado.");
  await prisma.$disconnect();
})();
