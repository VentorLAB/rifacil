import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

export const subscriptionRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findUnique({
      where: { userId: ctx.businessId },
    });
    return sub;
  }),

  getPlans: protectedProcedure.query(async () => {
    return [
      {
        id: "FREE",
        name: "Gratis",
        price: 0,
        features: ["1 rifa activa", "50 contactos", "100 números", "Sin campañas"],
        limits: { maxRaffles: 1, maxContacts: 50, maxVendors: 0, maxNumbers: 100, maxCampaignsPerMonth: 0 },
      },
      {
        id: "STARTER",
        name: "Starter",
        price: 29000,
        priceUSD: 7,
        features: ["3 rifas activas", "500 contactos", "2 vendedores", "1,000 números", "3 campañas/mes"],
        limits: { maxRaffles: 3, maxContacts: 500, maxVendors: 2, maxNumbers: 1000, maxCampaignsPerMonth: 3 },
      },
      {
        id: "PRO",
        name: "Pro",
        price: 79000,
        priceUSD: 19,
        features: ["10 rifas activas", "5,000 contactos", "10 vendedores", "10,000 números", "10 campañas/mes", "API access"],
        limits: { maxRaffles: 10, maxContacts: 5000, maxVendors: 10, maxNumbers: 10000, maxCampaignsPerMonth: 10 },
        popular: true,
      },
      {
        id: "ENTERPRISE",
        name: "Empresarial",
        price: 199000,
        priceUSD: 49,
        features: ["Rifas ilimitadas", "Contactos ilimitados", "Vendedores ilimitados", "Números ilimitados", "Campañas ilimitadas", "White-label", "Soporte prioritario"],
        limits: { maxRaffles: 999999, maxContacts: 999999, maxVendors: 999999, maxNumbers: 999999, maxCampaignsPerMonth: 999999 },
      },
    ];
  }),

  createCheckout: protectedProcedure
    .input(z.object({ planId: z.enum(["STARTER", "PRO", "ENTERPRISE"]) }))
    .mutation(async ({ ctx, input }) => {
      // Integración con Stripe
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Integración con Stripe pendiente" });
    }),

  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.subscription.update({
      where: { userId: ctx.businessId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    });
    return { success: true };
  }),
});
