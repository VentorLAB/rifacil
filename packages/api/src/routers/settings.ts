import { z } from "zod";
import { PaymentMethod } from "@riffas/db";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { fetchBinanceP2PRate, getActiveRate, saveRate } from "../lib/exchangeRate";

// Valores válidos del enum PaymentMethod de Prisma (Set para filtrado O(1)).
const VALID_PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));

// Mapea el string[] de Zod al enum PaymentMethod, descartando inválidos.
// Acepta variantes en minúscula/espacios para tolerar entradas de la UI.
function toPaymentMethods(raw: string[]): PaymentMethod[] {
  const seen = new Set<PaymentMethod>();
  for (const item of raw) {
    const candidate = item.trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (VALID_PAYMENT_METHODS.has(candidate)) {
      seen.add(candidate as PaymentMethod);
    }
  }
  return [...seen];
}

export const settingsRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await ctx.prisma.userSettings.findUnique({
      where: { userId: ctx.businessId },
    });
    return settings;
  }),

  update: protectedProcedure
    .input(
      z.object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        language: z.string().optional(),
        currency: z.string().optional(),
        timezone: z.string().optional(),
        emailNotifications: z.boolean().optional(),
        smsNotifications: z.boolean().optional(),
        pushNotifications: z.boolean().optional(),
        whatsappNotifications: z.boolean().optional(),
        acceptedPaymentMethods: z.array(z.string()).optional(),
        receiptTemplate: z.string().optional(),
        whatsappSaleTemplate: z.string().optional(),
        emailSaleTemplate: z.string().optional(),
        autoConfirmPayments: z.boolean().optional(),
        autoSendReceipt: z.boolean().optional(),
        autoSendWhatsApp: z.boolean().optional(),
        reservationExpiryMinutes: z.number().min(5).max(1440).optional(),
        // WhatsApp Cloud API (BSP) — credenciales para envío masivo (upgrade).
        whatsappProvider: z.enum(["NONE", "CLOUD_API"]).optional(),
        whatsappPhoneNumber: z.string().optional().nullable(),
        whatsappPhoneNumberId: z.string().optional().nullable(),
        whatsappBusinessId: z.string().optional().nullable(),
        whatsappApiToken: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Mapear acceptedPaymentMethods (string[]) al enum PaymentMethod antes de
      // guardar; descartar inválidos para que guardar Ajustes nunca falle.
      const { acceptedPaymentMethods, ...rest } = input;
      const data = {
        ...rest,
        ...(acceptedPaymentMethods !== undefined && {
          acceptedPaymentMethods: toPaymentMethods(acceptedPaymentMethods),
        }),
      };

      const settings = await ctx.prisma.userSettings.upsert({
        where: { userId: ctx.businessId },
        update: data,
        create: {
          userId: ctx.businessId,
          ...data,
        },
      });
      return settings;
    }),

  // --- Medios de pago / Datos de cobro (una fila por método) ---

  listPaymentAccounts: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.paymentAccount.findMany({
      where: { userId: ctx.businessId },
      orderBy: { method: "asc" },
    });
  }),

  savePaymentAccount: protectedProcedure
    .input(
      z.object({
        method: z.nativeEnum(PaymentMethod),
        active: z.boolean().default(true),
        bankName: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        idDocument: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        wallet: z.string().optional().nullable(),
        holderName: z.string().optional().nullable(),
        accountNumber: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
      const { method } = input;
      const data = {
        active: input.active,
        bankName: clean(input.bankName),
        phone: clean(input.phone),
        idDocument: clean(input.idDocument),
        email: clean(input.email),
        wallet: clean(input.wallet),
        holderName: clean(input.holderName),
        accountNumber: clean(input.accountNumber),
        note: clean(input.note),
      };

      return ctx.prisma.paymentAccount.upsert({
        where: { userId_method: { userId: ctx.businessId, method } },
        update: data,
        create: { userId: ctx.businessId, method, ...data },
      });
    }),

  // --- Tasa de cambio USD <-> VES ---

  getRate: protectedProcedure.query(async ({ ctx }) => {
    return getActiveRate(ctx.prisma, ctx.businessId);
  }),

  // Trae la tasa de Binance P2P y la guarda. Si la fuente falla, sugiere el override manual.
  refreshRate: protectedProcedure.mutation(async ({ ctx }) => {
    let rate: number;
    try {
      rate = await fetchBinanceP2PRate();
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No se pudo obtener la tasa de Binance P2P. Ingrésala manualmente.",
      });
    }
    return saveRate(ctx.prisma, ctx.businessId, rate, "BINANCE");
  }),

  // Override manual de la tasa (cuando la fuente automática no está disponible).
  setManualRate: protectedProcedure
    .input(z.object({ vesPerUsd: z.number().positive("La tasa debe ser mayor a 0") }))
    .mutation(async ({ ctx, input }) => {
      return saveRate(ctx.prisma, ctx.businessId, input.vesPerUsd, "MANUAL");
    }),
});
