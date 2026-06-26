/**
 * Datos que el recibo (Satori, @riffas/shared) necesita y que NO viajan en la
 * sesión. Centralizado aquí para que el panel (sale.ts), el portal del vendedor
 * (vendorPortal.ts) y la tienda pública (public.ts) emitan recibos IDÉNTICOS:
 * misma marca (logo/instagram/web) y misma escasez dinámica.
 */

// La marca del rifero NO viaja en la sesión (solo id/name/email/image): la
// leemos de la DB para que el recibo aplique nombre/color/logo + instagram/web.
export async function brandFor(prisma: any, userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      brandName: true,
      brandColor: true,
      brandLogo: true,
      customDomain: true,
      storefrontConfig: true,
    },
  });
  // instagram / website viven en el JSON de la tienda de marca (storefrontConfig).
  // Para el recibo queremos el @handle (no la URL): preferimos instagramHandle.
  const cfg = (u?.storefrontConfig ?? {}) as Record<string, any>;
  const instagram =
    (typeof cfg.instagramHandle === "string" ? cfg.instagramHandle : null) ||
    (typeof cfg.instagram === "string" ? cfg.instagram : null);
  const website =
    (u?.customDomain as string | null) ||
    (typeof cfg.website === "string" ? cfg.website : null);
  return {
    brandName: (u?.brandName || u?.name || "Riffas") as string,
    brandColor: (u?.brandColor ?? null) as string | null,
    brandLogo: (u?.brandLogo ?? null) as string | null,
    brandInstagram: instagram,
    brandWebsite: website,
  };
}

// Foto LIMPIA del premio para el banner del recibo (NO el flyer = raffle.bannerUrl).
// Mapeada por título de rifa. Si el título está acá, se usa este valor (aunque sea
// null = banner oscuro) y NO se cae al flyer. Si NO está, se usa raffle.bannerUrl.
// El Dubai: pendiente la URL del Toyota blanco (placa A09150A, fondo montaña).
const PRIZE_PHOTO: Record<string, string | null> = {
  "El Dubai": null, // TODO: pegar la URL de Cloudinary del Toyota limpio cuando llegue
};
function prizePhotoFor(raffle: any): string | null {
  return raffle.title in PRIZE_PHOTO
    ? PRIZE_PHOTO[raffle.title]
    : ((raffle.bannerUrl ?? null) as string | null);
}

// Campos de la rifa que el recibo necesita, incluyendo la ESCASEZ dinámica
// (números disponibles AHORA -> "quedan N" + % vendido), la foto del premio y los
// packs reales (para el gancho de descuento). `raffle` debe traer los escalares
// (title, loteria, drawDate, prize, bannerUrl, totalNumbers, pricePerNumber,
// discountPackages) — un findFirst/findUnique sin select los incluye todos.
export async function raffleReceiptFields(
  prisma: any,
  raffle: any,
  prizes: { titulo: string }[]
) {
  const remaining = await prisma.raffleNumber.count({
    where: { raffleId: raffle.id, status: "AVAILABLE" },
  });
  return {
    title: raffle.title as string,
    lottery: (raffle.loteria ?? null) as string | null,
    drawDate: (raffle.drawDate ?? null) as Date | null,
    prizes,
    prize: (raffle.prize ?? null) as string | null,
    bannerUrl: prizePhotoFor(raffle),
    totalNumbers: (raffle.totalNumbers ?? null) as number | null,
    remaining,
    pricePerNumber: raffle.pricePerNumber != null ? Number(raffle.pricePerNumber) : null,
    discountPackages: (raffle.discountPackages ?? null) as
      | { qty: number; discountPercent: number }[]
      | null,
  };
}
