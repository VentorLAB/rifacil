// Setea branding + logo + dominio propio de Orlando (Grandes Rifas Hermanos Pernía).
// Idempotente: corre las veces que sea, deja el mismo estado. NO sube nada a
// Cloudinary — el logo ya está subido (URL fija abajo), así sirve igual para
// dev y para PROD.
//
// Uso (dev o prod): cargar DATABASE_URL/DIRECT_URL del entorno destino y correr:
//   pnpm --filter @riffas/db exec tsx scripts/set-pernia-brand-domain.ts
import { prisma } from "../src";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const BRAND_NAME = "Grandes Rifas Hermanos Pernía";
const BRAND_COLOR = "#DF0815";           // rojo del uniforme HP
const BRAND_COLOR_SECONDARY = "#1A1A1A"; // negro del uniforme HP
const CUSTOM_DOMAIN = "rifashermanospernia.com"; // minúsculas, sin www.
// Logo ya subido a Cloudinary (publicId fijo "pernia-logo"). Cloudinary es la
// MISMA cuenta para dev y prod, así que esta URL funciona en ambos sin re-subir.
const BRAND_LOGO = "https://res.cloudinary.com/dbi6monrl/image/upload/v1781963171/riffas/brands/pernia-logo.png";

function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}`);

  const before = await prisma.user.findUnique({
    where: { email: ORLANDO_EMAIL },
    select: { id: true, brandName: true, brandColor: true, brandColorSecondary: true, customDomain: true },
  });
  if (!before) { console.error("Orlando no encontrado"); process.exit(1); }
  console.log("[antes]", JSON.stringify(before));

  // Chequeo de colisión de customDomain (el campo es @unique)
  const collision = await prisma.user.findFirst({
    where: { customDomain: CUSTOM_DOMAIN, NOT: { id: before.id } },
    select: { id: true, email: true },
  });
  if (collision) {
    console.error(`COLISIÓN: el dominio ${CUSTOM_DOMAIN} ya está en ${collision.email}. Abortado.`);
    process.exit(2);
  }

  const after = await prisma.user.update({
    where: { id: before.id },
    data: {
      brandName: BRAND_NAME,
      brandLogo: BRAND_LOGO,
      brandColor: BRAND_COLOR,
      brandColorSecondary: BRAND_COLOR_SECONDARY,
      customDomain: CUSTOM_DOMAIN,
    },
    select: { id: true, brandName: true, brandLogo: true, brandColor: true, brandColorSecondary: true, customDomain: true },
  });
  console.log("[después]", JSON.stringify(after));
  console.log("✅ OK");
  await prisma.$disconnect();
})();
