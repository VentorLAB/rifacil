import { z } from "zod";
import { createTRPCRouter, protectedProcedure, premiumProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { generateNumbers, normalizePhone } from "@riffas/shared";
import { uploadImage } from "@riffas/shared/cloudinary";

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

// Premio individual al crear/editar una rifa (el `orden` lo asigna el servidor).
const prizeInput = z.object({
  titulo: z.string().min(1, "El título del premio es obligatorio").max(120),
  descripcion: z.string().max(500).optional(),
  imagenUrl: z.string().url().optional(),
});

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
      const { prisma } = ctx;
      const { status = "ALL", search, limit = 20, cursor } = input || {};

      const where: any = { userId: ctx.businessId };
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
        where: { id: input.id, userId: ctx.businessId },
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

  // Listar números de una rifa, paginado + filtros (para el tablero de números).
  // Paginado en servidor: una rifa puede tener 10.000 números — nunca los traemos
  // todos de golpe.
  listNumbers: protectedProcedure
    .input(
      z.object({
        raffleId: z.string(),
        status: z.enum(["ALL", "AVAILABLE", "RESERVED", "SOLD", "PAID"]).default("ALL"),
        search: z.string().optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(20).max(500).default(120),
      })
    )
    .query(async ({ ctx, input }) => {
      const { prisma } = ctx;

      // Multi-tenant: la rifa debe ser del usuario en sesión.
      const raffle = await prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: ctx.businessId },
        select: { id: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const where: any = { raffleId: input.raffleId };
      if (input.status !== "ALL") where.status = input.status;
      const search = input.search?.trim();
      if (search) where.number = { contains: search };

      const [total, numbers] = await Promise.all([
        prisma.raffleNumber.count({ where }),
        prisma.raffleNumber.findMany({
          where,
          orderBy: { number: "asc" },
          skip: input.page * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            number: true,
            status: true,
            saleId: true,
            contact: { select: { id: true, name: true, phone: true } },
          },
        }),
      ]);

      return {
        numbers,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
      };
    }),

  // --- Premios de la rifa ---

  listPrizes: protectedProcedure
    .input(z.object({ raffleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: ctx.businessId },
        select: { id: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.prisma.prize.findMany({
        where: { raffleId: input.raffleId },
        orderBy: { orden: "asc" },
      });
    }),

  // Reemplaza TODOS los premios de la rifa (maneja añadir/quitar/reordenar en una
  // sola operación; el orden es la posición en el array). Multi-tenant.
  setPrizes: protectedProcedure
    .input(
      z.object({
        raffleId: z.string(),
        prizes: z.array(prizeInput),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: ctx.businessId },
        select: { id: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.prisma.$transaction([
        ctx.prisma.prize.deleteMany({ where: { raffleId: input.raffleId } }),
        ctx.prisma.prize.createMany({
          data: input.prizes.map((p, i) => ({
            raffleId: input.raffleId,
            titulo: p.titulo,
            descripcion: p.descripcion || null,
            imagenUrl: p.imagenUrl || null,
            orden: i,
          })),
        }),
      ]);

      return ctx.prisma.prize.findMany({
        where: { raffleId: input.raffleId },
        orderBy: { orden: "asc" },
      });
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
        prizes: z.array(prizeInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      // Verificar límite de rifas según plan
      const sub = await prisma.subscription.findUnique({
        where: { userId: ctx.businessId },
      });

      const raffleCount = await prisma.raffle.count({
        where: { userId: ctx.businessId, status: { not: "CANCELLED" } },
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
      const { contactWhatsapp, prizes, ...rest } = input;
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
          userId: ctx.businessId,
          status: "DRAFT",
        },
      });

      // Crear premios (orden = posición en el array)
      if (prizes && prizes.length > 0) {
        await prisma.prize.createMany({
          data: prizes.map((p, i) => ({
            raffleId: raffle.id,
            titulo: p.titulo,
            descripcion: p.descripcion || null,
            imagenUrl: p.imagenUrl || null,
            orden: i,
          })),
        });
      }

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
        where: { userId: ctx.businessId },
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
        where: { id: input.id, userId: ctx.businessId },
        data: { status: "ACTIVE" },
      });
      return raffle;
    }),

  // Pausar rifa
  pause: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.update({
        where: { id: input.id, userId: ctx.businessId },
        data: { status: "PAUSED" },
      });
      return raffle;
    }),

  // Eliminar rifa (multi-tenant: solo rifas del usuario en sesión).
  // Protege los datos: si hay ventas registradas NO borra en duro; bloquea.
  // Sin ventas (rifas de prueba) -> borrado en duro, los números caen por cascade.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      // Verificar propiedad (multi-tenant).
      const raffle = await prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true, totalNumbers: true },
      });
      if (!raffle) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada" });
      }

      // ¿Tiene ventas o números vendidos/pagados? -> no se puede borrar.
      const [salesCount, soldNumbers] = await Promise.all([
        prisma.sale.count({ where: { raffleId: raffle.id } }),
        prisma.raffleNumber.count({
          where: { raffleId: raffle.id, status: { in: ["SOLD", "PAID"] } },
        }),
      ]);
      if (salesCount > 0 || soldNumbers > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puedes eliminar una rifa con ventas registradas",
        });
      }

      // Borrado en duro. RaffleNumber tiene onDelete: Cascade.
      await prisma.raffle.delete({ where: { id: raffle.id } });

      // Liberar uso del plan (no baja de 0 en la práctica; simétrico al create).
      await prisma.subscription.updateMany({
        where: { userId: ctx.businessId },
        data: {
          rafflesUsed: { decrement: 1 },
          numbersUsed: { decrement: raffle.totalNumbers },
        },
      });

      return { success: true };
    }),

  // Estado del sorteo: ganador (con su contacto) o números elegibles si falta sortear.
  getDraw: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: {
          status: true,
          winnerNumber: true,
          winnerId: true,
          drawSeed: true,
          drawTimestamp: true,
        },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const eligible = await ctx.prisma.raffleNumber.count({
        where: { raffleId: input.id, status: { in: ["SOLD", "PAID"] } },
      });

      let winner: { number: string; name: string | null; phone: string | null } | null = null;
      if (raffle.status === "DRAWN" && raffle.winnerNumber) {
        const contact = raffle.winnerId
          ? await ctx.prisma.contact.findUnique({
              where: { id: raffle.winnerId },
              select: { name: true, phone: true },
            })
          : null;
        winner = {
          number: raffle.winnerNumber,
          name: contact?.name ?? null,
          phone: contact?.phone ?? null,
        };
      }

      return {
        status: raffle.status,
        eligible,
        seed: raffle.drawSeed,
        drawnAt: raffle.drawTimestamp,
        winner,
      };
    }),

  // Realizar sorteo: elige ganador (aleatorio verificable por seed) entre los
  // números vendidos/pagados. Permitido en ACTIVE/PAUSED/SOLD_OUT.
  draw: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        method: z
          .enum(["RANDOM_SYSTEM", "LIVE_STREAM", "PHYSICAL_BALLS", "BLOCKCHAIN"])
          .default("RANDOM_SYSTEM"),
        seed: z.string().optional(), // Para reproducibilidad
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      const raffle = await prisma.raffle.findFirst({
        where: {
          id: input.id,
          userId: ctx.businessId,
          status: { in: ["ACTIVE", "PAUSED", "SOLD_OUT"] },
        },
        include: { numbers: { where: { status: { in: ["SOLD", "PAID"] } }, orderBy: { number: "asc" } } },
      });

      if (!raffle) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada o ya sorteada" });
      }

      const soldNumbers = raffle.numbers;
      if (soldNumbers.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No hay números vendidos para sortear" });
      }

      // Número ganador (aleatorio verificable a partir del seed).
      const seed = input.seed || `${input.id}-${soldNumbers.length}-${ctx.businessId}`;
      const winnerIndex = await provableRandom(soldNumbers.length, seed);
      const winner = soldNumbers[winnerIndex];

      const updated = await prisma.raffle.update({
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

      // Auditoría del sorteo.
      await prisma.activityLog.create({
        data: {
          userId: ctx.businessId,
          action: "RAFFLE_DRAWN",
          entityType: "Raffle",
          entityId: input.id,
          metadata: { winnerNumber: winner.number, seed },
        },
      });

      const contact = winner.contactId
        ? await prisma.contact.findUnique({
            where: { id: winner.contactId },
            select: { name: true, phone: true },
          })
        : null;

      return {
        winnerNumber: winner.number,
        seed,
        winner: { name: contact?.name ?? null, phone: contact?.phone ?? null },
        drawnAt: updated.drawTimestamp,
      };
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
        where: { id: input.id, userId: ctx.businessId },
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

  // Reporte completo de una rifa: dinero (recaudado/facturado/por cobrar),
  // números por estado, % vendido, top clientes y ventas por vendedor. Multi-tenant.
  getReport: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { prisma } = ctx;

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true, title: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      // Conteo de números por estado.
      const grouped = await prisma.raffleNumber.groupBy({
        by: ["status"],
        where: { raffleId: raffle.id },
        _count: { _all: true },
      });
      const byStatus: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, PAID: 0 };
      for (const g of grouped) byStatus[g.status] = g._count._all;
      const totalNumbers = Object.values(byStatus).reduce((a, b) => a + b, 0);
      const soldCount = byStatus.SOLD + byStatus.PAID;
      const soldPct = totalNumbers > 0 ? Math.round((soldCount / totalNumbers) * 1000) / 10 : 0;

      // Ventas activas (no canceladas) con su cliente y vendedor.
      const sales = await prisma.sale.findMany({
        where: { raffleId: raffle.id, status: { notIn: ["CANCELLED", "REFUNDED"] } },
        select: {
          contactId: true,
          vendorId: true,
          finalAmount: true,
          amountPaid: true,
          totalNumbers: true,
          contact: { select: { id: true, name: true, phone: true } },
          vendor: { select: { id: true, name: true, lastName: true } },
        },
      });

      let billed = 0;
      let collected = 0;
      const clientMap = new Map<string, { id: string; name: string; phone: string; collected: number; numbers: number }>();
      const vendorMap = new Map<string, { id: string; name: string; collected: number; numbers: number; salesCount: number }>();

      for (const s of sales) {
        const fa = Number(s.finalAmount);
        const ap = Number(s.amountPaid);
        billed += fa;
        collected += ap;

        if (s.contact) {
          const c = clientMap.get(s.contact.id) ?? {
            id: s.contact.id,
            name: s.contact.name,
            phone: s.contact.phone,
            collected: 0,
            numbers: 0,
          };
          c.collected += ap;
          c.numbers += s.totalNumbers;
          clientMap.set(s.contact.id, c);
        }

        if (s.vendor) {
          const vName = `${s.vendor.name}${s.vendor.lastName ? ` ${s.vendor.lastName}` : ""}`;
          const v = vendorMap.get(s.vendor.id) ?? {
            id: s.vendor.id,
            name: vName,
            collected: 0,
            numbers: 0,
            salesCount: 0,
          };
          v.collected += ap;
          v.numbers += s.totalNumbers;
          v.salesCount += 1;
          vendorMap.set(s.vendor.id, v);
        }
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const pending = Math.max(0, round2(billed - collected));

      const topClients = [...clientMap.values()]
        .map((c) => ({ ...c, collected: round2(c.collected) }))
        .sort((a, b) => b.collected - a.collected)
        .slice(0, 10);

      const byVendor = [...vendorMap.values()]
        .map((v) => ({ ...v, collected: round2(v.collected) }))
        .sort((a, b) => b.collected - a.collected);

      return {
        raffleTitle: raffle.title,
        totals: {
          numbers: totalNumbers,
          available: byStatus.AVAILABLE,
          reserved: byStatus.RESERVED,
          sold: byStatus.SOLD,
          paid: byStatus.PAID,
          soldPct,
        },
        money: { billed: round2(billed), collected: round2(collected), pending },
        topClients,
        byVendor,
      };
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
        where: { id: input.id, userId: ctx.businessId },
        data: input.data,
      });
      return raffle;
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
