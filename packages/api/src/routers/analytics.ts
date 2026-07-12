import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";

export const analyticsRouter = createTRPCRouter({
  health: publicProcedure.query(() => "ok"),

  // Resumen para el home del panel: tarjetas de métricas. Todo filtra por userId (multi-tenant).
  summary: protectedProcedure.query(async ({ ctx }) => {
    const { prisma } = ctx;
    const businessId = ctx.businessId; // rifas/ventas compartidas del negocio
    const userId = ctx.userId; // contactos personales del usuario

    const [activeRaffles, rafflesTotal, contactsCount, salesAgg] = await Promise.all([
      prisma.raffle.count({ where: { userId: businessId, status: "ACTIVE" } }),
      prisma.raffle.count({ where: { userId: businessId, status: { not: "CANCELLED" } } }),
      prisma.contact.count({ where: { userId } }),
      prisma.sale.aggregate({
        where: { userId: businessId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
        _sum: { finalAmount: true, amountPaid: true },
        _count: true,
      }),
    ]);

    const billed = Number(salesAgg._sum.finalAmount ?? 0);
    const collected = Number(salesAgg._sum.amountPaid ?? 0);
    const pending = Math.max(0, Number((billed - collected).toFixed(2)));

    return {
      activeRaffles,
      rafflesTotal,
      contactsCount,
      salesCount: salesAgg._count,
      collected,
      pending,
    };
  }),

  // Estado del checklist "Primeros pasos" del panel (estilo Canva): 4 hitos que
  // llevan al rifero hasta su primer recibo enviado (el "aha moment" de la app).
  onboarding: protectedProcedure.query(async ({ ctx }) => {
    const { prisma } = ctx;
    const businessId = ctx.businessId;

    const [user, raffles, sales, withReceipt] = await Promise.all([
      prisma.user.findUnique({
        where: { id: businessId },
        select: { brandName: true, brandLogo: true },
      }),
      prisma.raffle.count({
        where: { userId: businessId, status: { not: "CANCELLED" } },
      }),
      prisma.sale.count({
        where: { userId: businessId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      }),
      prisma.sale.count({
        where: {
          userId: businessId,
          receiptUrl: { not: null },
          status: { notIn: ["CANCELLED", "REFUNDED"] },
        },
      }),
    ]);

    return {
      hasBrand: !!(user?.brandName || user?.brandLogo),
      hasRaffle: raffles > 0,
      hasSale: sales > 0,
      hasReceipt: withReceipt > 0,
    };
  }),

  // Tarjetas de la pantalla /dashboard/analytics.
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const { prisma } = ctx;
    const businessId = ctx.businessId;
    const userId = ctx.userId;

    const [salesAgg, totalContacts, totalRaffles] = await Promise.all([
      prisma.sale.aggregate({
        where: { userId: businessId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
        _sum: { finalAmount: true },
        _count: true,
      }),
      prisma.contact.count({ where: { userId } }),
      prisma.raffle.count({ where: { userId: businessId, status: { not: "CANCELLED" } } }),
    ]);

    return {
      totalSales: salesAgg._count,
      totalRevenue: Number(salesAgg._sum.finalAmount ?? 0),
      totalContacts,
      totalRaffles,
    };
  }),
});
