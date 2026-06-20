// Pega este procedure DENTRO de `publicRouter` en
// packages/api/src/routers/public.ts  (junto a getRaffle, listNumbers, etc.)
//
// Resuelve la tienda de un rifero a partir de su dominio propio y devuelve
// sus rifas activas (cada una enlaza al /r/[id] que ya existe).

getStorefrontByDomain: publicProcedure
  .input(z.object({ host: z.string() }))
  .query(async ({ ctx, input }) => {
    const host = input.host.toLowerCase().replace(/^www\./, "");

    const rifero = await ctx.prisma.user.findFirst({
      where: { customDomain: host },
      select: {
        id: true,
        name: true,
        brandName: true,
        brandLogo: true,
        brandColor: true,
        brandColorSecondary: true,
      },
    });
    if (!rifero) throw new TRPCError({ code: "NOT_FOUND" });

    const raffles = await ctx.prisma.raffle.findMany({
      where: {
        userId: rifero.id,
        isPublic: true,
        status: { in: ["ACTIVE", "PAUSED", "DRAWN"] },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        prize: true,
        pricePerNumber: true,
        bannerUrl: true,
        bannerMobileUrl: true,
        iconUrl: true,
        color: true,
        status: true,
        drawDate: true,
        loteria: true,
        soldCount: true,
        totalNumbers: true,
      },
    });

    return {
      brand: {
        name: rifero.brandName || rifero.name || "Rifas",
        logo: rifero.brandLogo,
        color: rifero.brandColor || "#7c3aed",
        colorSecondary: rifero.brandColorSecondary || "#1e293b",
      },
      raffles: raffles.map((r) => ({
        ...r,
        pricePerNumber: Number(r.pricePerNumber),
      })),
    };
  }),
