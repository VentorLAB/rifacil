import { z } from "zod";
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

  // --- Metering WhatsApp: "mensajes este mes" por tenant ---
  // Base de la futura refacturación (rifacil paga Meta y revende con margen).
  // HOY cada rifero paga su WABA: esto solo MIDE y reporta. El costo es
  // estimado (ver pricingNote de cada fila); el volumen es exacto.
  whatsappUsage: protectedProcedure
    .input(
      z
        .object({
          // YYYY-MM; default: mes actual en UTC
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const month = input?.month ?? new Date().toISOString().slice(0, 7);
      const from = new Date(`${month}-01T00:00:00.000Z`);
      const to = new Date(from);
      to.setUTCMonth(to.getUTCMonth() + 1);

      const rows = await ctx.prisma.whatsappMessageLog.findMany({
        where: { businessId: ctx.businessId, createdAt: { gte: from, lt: to } },
        select: { category: true, status: true, costUsd: true, countryCode: true },
      });

      const byStatus: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      let costUsdEstimated = 0;
      let unrated = 0;
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        byCategory[r.category] = (byCategory[r.category] || 0) + 1;
        if (r.costUsd != null) costUsdEstimated += r.costUsd;
        else unrated++;
      }
      return {
        month,
        totalMessages: rows.length,
        byStatus,
        byCategory,
        costUsdEstimated: Number(costUsdEstimated.toFixed(4)),
        unratedCount: unrated,
        note: "Costo estimado por mensaje entregado según tarifa Meta por país (verificar tabla vigente); plantillas utility dentro de ventana de servicio pueden ser $0.",
      };
    }),

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
