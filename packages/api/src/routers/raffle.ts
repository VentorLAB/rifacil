import { z } from "zod";
import { createTRPCRouter, protectedProcedure, premiumProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { generateNumbers, normalizePhone } from "@riffas/shared";
import { uploadImage } from "@riffas/shared/cloudinary";

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export const raffleRouter = createTRPCRouter({
  // Listar rifas del usuario
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["ALL", "DRAFT", "ACTIVE", "PAUSED", "SOLD_OUT", "DRAWN", "CANCELLED"]).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { prisma, session } = ctx;
      const { status = "ALL", search, limit = 20, cursor } = input || {};

      const where: any = { userId: session.user.id };
      if (status !== "ALL") where.status = status;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { prize: { contains: search, mode: "insensitive" } },
        ];
      }

      const raffles = await prisma.raffle.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { numbers: true } },
        },
      });

      let nextCursor: typeof cursor | undefined = undefined;
      if (raffles.length > limit) {
        const nextItem = raffles.pop();
        nextCursor = nextItem!.id;
      }

      return { raffles, nextCursor };
    }),

  // Obtener una rifa con detalle completo
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          numbers: {
            orderBy: { number: "asc" },
            include: {
              contact: { select: { id: true, name: true, phone: true } },
              vendor: { select: { id: true, name: true, code: true } },
            },
          },
          _count: {
            select: {
              numbers: {
                where: { status: { in: ["SOLD", "PAID"] } },
              },
            },
          },
        },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });
      return raffle;
    }),

  // Crear nueva rifa
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(3).max(100),
        description: z.string().optional(),
        prize: z.string().min(3),
        prizeValue: z.number().positive(),
        prizeImages: z.array(z.string().url()).optional(),
        totalNumbers: z.number().min(10).max(100000),
        pricePerNumber: z.number().positive(),
        numberFormat: z.string().default("000"),
        numberPrefix: z.string().optional(),
        numberSuffix: z.string().optional(),
        allowPickNumbers: z.boolean().default(true),
        allowRandom: z.boolean().default(true),
        minPurchase: z.number().min(1).default(1),
        maxPurchase: z.number().optional(),
        discountPackages: z.array(
          z.object({
            qty: z.number().min(2),
            discountPercent: z.number().min(1).max(100),
          })
        ).optional(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime().optional(),
        drawDate: z.string().datetime().optional(),
        buyDeadline: z.string().datetime().optional(),
        isPublic: z.boolean().default(true),
        allowSharing: z.boolean().default(true),
        passwordProtected: z.boolean().default(false),
        password: z.string().optional(),
        // Datos del organizador / sorteo + branding
        representanteLegal: z.string().max(120).optional(),
        representanteCedula: z.string().max(40).optional(),
        loteria: z.string().max(120).optional(),
        contactWhatsapp: z.string().min(6).optional(),
        color: z.string().regex(HEX_COLOR, "Color inválido (usa formato #rrggbb)").optional(),
        bannerUrl: z.string().url().optional(),
        bannerMobileUrl: z.string().url().optional(),
        iconUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      // Verificar límite de rifas según plan
      const sub = await prisma.subscription.findUnique({
        where: { userId: session.user.id },
      });

      const raffleCount = await prisma.raffle.count({
        where: { userId: session.user.id, status: { not: "CANCELLED" } },
      });

      if (sub && raffleCount >= sub.maxRaffles) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Has alcanzado el límite de ${sub.maxRaffles} rifas para tu plan. Actualiza para crear más.`,
        });
      }

      // Verificar límite de números
      if (sub && input.totalNumbers > sub.maxNumbers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Tu plan permite máximo ${sub.maxNumbers} números por rifa.`,
        });
      }

      // Normalizar WhatsApp de contacto (default Venezuela)
      const { contactWhatsapp, ...rest } = input;
      let normalizedWhatsapp: string | undefined;
      if (contactWhatsapp) {
        const n = normalizePhone(contactWhatsapp, "VE");
        if (!n) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El WhatsApp de contacto no es un número válido.",
          });
        }
        normalizedWhatsapp = n;
      }

      // Crear rifa
      const raffle = await prisma.raffle.create({
        data: {
          ...rest,
          contactWhatsapp: normalizedWhatsapp,
          userId: session.user.id,
          status: "DRAFT",
        },
      });

      // Generar números
      const numbers = generateNumbers({
        format: input.numberFormat,
        total: input.totalNumbers,
        prefix: input.numberPrefix,
        suffix: input.numberSuffix,
      });

      // Insertar números en batch
      const batchSize = 1000;
      for (let i = 0; i < numbers.length; i += batchSize) {
        const batch = numbers.slice(i, i + batchSize);
        await prisma.raffleNumber.createMany({
          data: batch.map((num) => ({
            raffleId: raffle.id,
            number: num,
            status: "AVAILABLE",
          })),
        });
      }

      // Actualizar uso (updateMany no lanza si no hay suscripción todavía).
      await prisma.subscription.updateMany({
        where: { userId: session.user.id },
        data: { rafflesUsed: { increment: 1 }, numbersUsed: { increment: input.totalNumbers } },
      });

      return raffle;
    }),

  // Subir una imagen de la rifa (banner / banner móvil / icono) a Cloudinary.
  // Recibe un data URI base64 desde el cliente y devuelve la secure_url.
  uploadImage: protectedProcedure
    .input(
      z.object({
        dataUri: z
          .string()
          .refine((v) => v.startsWith("data:image/"), "Debe ser una imagen"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const url = await uploadImage(input.dataUri, { folder: "riffas/raffles" });
        return { url };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo subir la imagen. Intenta de nuevo.",
        });
      }
    }),

  // Activar rifa
  activate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { status: "ACTIVE" },
      });
      return raffle;
    }),

  // Pausar rifa
  pause: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { status: "PAUSED" },
      });
      return raffle;
    }),

  // Realizar sorteo
  draw: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        method: z.enum(["RANDOM_SYSTEM", "LIVE_STREAM", "PHYSICAL_BALLS", "BLOCKCHAIN"]),
        seed: z.string().optional(), // Para reproducibilidad
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.session.user.id, status: "SOLD_OUT" },
        include: { numbers: { where: { status: { in: ["SOLD", "PAID"] } } } },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada o no está agotada" });

      // Generar número ganador
      const soldNumbers = raffle.numbers;
      const seed = input.seed || crypto.randomUUID();
      const winnerIndex = await provableRandom(soldNumbers.length, seed);
      const winner = soldNumbers[winnerIndex];

      await prisma.raffle.update({
        where: { id: input.id },
        data: {
          status: "DRAWN",
          winnerNumber: winner.number,
          winnerId: winner.contactId,
          drawMethod: input.method,
          drawTimestamp: new Date(),
          drawSeed: seed,
        },
      });

      return { winnerNumber: winner.number, seed };
    }),

  // Obtener rifa pública (sin auth)
  getPublic: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: {
          // El slug de marca vive en el User (rifero), no en Raffle.
          user: { brandSlug: input.slug },
          status: { in: ["ACTIVE", "SOLD_OUT", "DRAWN"] },
          isPublic: true,
        },
        include: {
          user: {
            select: {
              brandName: true,
              brandLogo: true,
              brandColor: true,
            },
          },
          _count: {
            select: {
              numbers: {
                where: { status: { in: ["SOLD", "PAID"] } },
              },
            },
          },
        },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      // Incrementar views
      await ctx.prisma.raffle.update({
        where: { id: raffle.id },
        data: { viewCount: { increment: 1 } },
      });

      return raffle;
    }),

  // Estadísticas de rifa
  getStats: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          numbers: {
            select: { status: true, number: true, soldAt: true, paidAt: true },
          },
          sales: {
            select: { finalAmount: true, status: true, createdAt: true, paymentMethod: true },
          },
        },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const stats = {
        total: raffle.numbers.length,
        available: raffle.numbers.filter((n) => n.status === "AVAILABLE").length,
        reserved: raffle.numbers.filter((n) => n.status === "RESERVED").length,
        sold: raffle.numbers.filter((n) => n.status === "SOLD").length,
        paid: raffle.numbers.filter((n) => n.status === "PAID").length,
        revenue: raffle.sales
          .filter((s) => s.status === "PAID")
          .reduce((sum, s) => sum + Number(s.finalAmount), 0),
        totalSales: raffle.sales.length,
        salesByDay: groupByDay(raffle.sales),
        salesByPaymentMethod: groupBy(raffle.sales, "paymentMethod"),
      };

      return stats;
    }),

  // Actualizar rifa
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          title: z.string().min(3).max(100).optional(),
          description: z.string().optional(),
          prize: z.string().min(3).optional(),
          prizeValue: z.number().positive().optional(),
          prizeImages: z.array(z.string().url()).optional(),
          pricePerNumber: z.number().positive().optional(),
          allowPickNumbers: z.boolean().optional(),
          allowRandom: z.boolean().optional(),
          minPurchase: z.number().min(1).optional(),
          maxPurchase: z.number().optional(),
          discountPackages: z.array(
            z.object({ qty: z.number(), discountPercent: z.number() })
          ).optional(),
          endDate: z.string().datetime().optional(),
          drawDate: z.string().datetime().optional(),
          isPublic: z.boolean().optional(),
          allowSharing: z.boolean().optional(),
          passwordProtected: z.boolean().optional(),
          password: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data: input.data,
      });
      return raffle;
    }),

  // Eliminar rifa
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.raffle.delete({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      return { success: true };
    }),
});

// Helper: Random verificable
async function provableRandom(max: number, seed: string): Promise<number> {
  // Usar hash del seed + timestamp para generar número aleatorio verificable
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashInt = parseInt(hashHex.slice(0, 8), 16);
  return hashInt % max;
}

function groupByDay(sales: any[]) {
  const grouped: Record<string, number> = {};
  sales.forEach((sale) => {
    const day = sale.createdAt.toISOString().split("T")[0];
    grouped[day] = (grouped[day] || 0) + Number(sale.finalAmount);
  });
  return grouped;
}

function groupBy(arr: any[], key: string) {
  const grouped: Record<string, number> = {};
  arr.forEach((item) => {
    const val = item[key] || "unknown";
    grouped[val] = (grouped[val] || 0) + Number(item.finalAmount);
  });
  return grouped;
}
