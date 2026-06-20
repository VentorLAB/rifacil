// Sube el logo de Grandes Rifas Hermanos Pernía a Cloudinary y setea brandLogo
// en el rifero Orlando. Idempotente: publicId fijo + overwrite (no duplica).
import { uploadImage } from "@riffas/shared/cloudinary";
import { prisma } from "@riffas/db";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
const LOCAL_PATH = "C:/Users/Veracorez.MZ/Downloads/hermanos-pernia-logo-final.png";

function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}`);
  if (!process.env.CLOUDINARY_API_KEY) { console.error("Faltan creds CLOUDINARY_*"); process.exit(1); }

  console.log(`[upload] subiendo ${LOCAL_PATH} ...`);
  const url = await uploadImage(LOCAL_PATH, {
    folder: "riffas/brands",
    publicId: "pernia-logo", // fijo → overwrite, una sola versión
  });
  console.log(`[upload] ✅ ${url}`);

  const updated = await prisma.user.update({
    where: { email: ORLANDO_EMAIL },
    data: { brandLogo: url },
    select: { id: true, brandName: true, brandLogo: true },
  });
  console.log("[db] brandLogo seteado:", JSON.stringify(updated));
  await prisma.$disconnect();
})();
