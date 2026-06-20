import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PaymentMethod } from "@riffas/db";
import { createTRPCRouter, publicProcedure, vendorProcedure } from "../trpc";
import { getVendorIdFromReq } from "../lib/vendorAuth";
import { getActiveRate } from "../lib/exchangeRate";
import { sendSaleReceiptWhatsApp } from "../lib/whatsapp";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Recibo server-side (best-effort). Mismo patrón que sale.ts: import diferido del
// generador (satori/resvg nativos) para no arrastrar binarios al cargar el router.
async function safeGenerateReceipt(args: any): Promise<string | null> {
  try {
    const { generateReceipt } = await import("@riffas/shared/receipt");
    return await generateReceipt(args);
  } catch (err) {
    console.error("[vendorPortal] generateReceipt falló; venta guardada sin recibo:", err);
    return null;
  }
}

async function brandFor(prisma: any, userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, brandName: true, brandColor: true, brandLogo: true },
  });
  return {
    brandName: (u?.brandName || u?.name || "Riffas") as string,
    brandColor: (u?.brandColor ?? null) as string | null,
    brandLogo: (u?.brandLogo ?? null) as string | null,
  };
}

// Genera y guarda el recibo de una venta (+ envío WhatsApp best-effort). Reutilizable.
async function emitReceipt(prisma: any, businessId: string, saleId: string) {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { contact: true, raffle: true } });
  if (!sale) return;
  const prizes = await prisma.prize.findMany({
    where: { raffleId: sale.raffleId },
    orderBy: { orden: "asc" },
    select: { titulo: true },
  });
  const brand = await brandFor(prisma, businessId);
  const receiptUrl = await safeGenerateReceipt({
    sale,
    raffle: { title: sale.raffle.title, lottery: sale.raffle.loteria, drawDate: sale.raffle.drawDate, prizes },
    contact: sale.contact,
    ...brand,
  });
  await prisma.sale.update({ where: { id: saleId }, data: { receiptUrl } });
  await prisma.raffleNumber.updateMany({ where: { saleId }, data: { receiptUrl } });
  try {
    await sendSaleReceiptWhatsApp({
      prisma,
      userId: businessId,
      sale: { ...sale, receiptUrl },
      raffleTitle: sale.raffle.title,
      brandName: brand.brandName,
    });
  } catch (err) {
    console.error("[vendorPortal] envío WhatsApp falló (venta guardada igual):", err);
  }
}

// Portal del VENDEDOR: lee la cookie de vendedor (no la sesión del rifero) y
// devuelve/gestiona SOLO lo suyo. Multi-tenant: el vendedor opera dentro del
// negocio de su rifero (ctx.businessId), y solo cobra/gestiona SUS ventas.
export const vendorPortalRouter = createTRPCRouter({
  me: publicProcedure.query(async ({ ctx }) => {
    const vendorId = getVendorIdFromReq(ctx.req);
    if (!vendorId) return null;

    const vendor = await ctx.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        lastName: true,
        code: true,
        commissionRate: true,
        role: true,
        active: true,
        userId: true,
      },
    });
    if (!vendor || !vendor.active) return null;

    const user = await ctx.prisma.user.findUnique({
      where: { id: vendor.userId },
      select: { name: true, brandName: true, brandColor: true, brandColorSecondary: true, brandLogo: true },
    });
    const raffles = await ctx.prisma.raffle.findMany({
      where: { userId: vendor.userId, status: "ACTIVE", isPublic: true },
      select: { id: true, title: true, pricePerNumber: true, numberFormat: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        lastName: vendor.lastName,
        code: vendor.code,
        commissionRate: Number(vendor.commissionRate),
        role: vendor.role,
      },
      brand: {
        name: user?.brandName || user?.name || "Rifas",
        color: user?.brandColor || "#3b82f6",
        colorSecondary: user?.brandColorSecondary || "#1e293b",
        logo: user?.brandLogo || null,
      },
      raffles: raffles.map((r) => ({
        id: r.id,
        title: r.title,
        pricePerNumber: Number(r.pricePerNumber),
        numberFormat: r.numberFormat,
      })),
    };
  }),

  sales: publicProcedure.query(async ({ ctx }) => {
    const vendorId = getVendorIdFromReq(ctx.req);
    if (!vendorId) return null;

    const vendor = await ctx.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { commissionRate: true, active: true },
    });
    if (!vendor || !vendor.active) return null;
    const rate = Number(vendor.commissionRate);

    const sales = await ctx.prisma.sale.findMany({
      where: { vendorId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        numbers: true,
        totalNumbers: true,
        finalAmount: true,
        amountPaid: true,
        status: true,
        contact: { select: { name: true } },
        raffle: { select: { title: true } },
      },
    });

    let collected = 0;
    let billed = 0;
    const items = sales.map((s) => {
      const ap = Number(s.amountPaid);
      const fa = Number(s.finalAmount);
      collected += ap;
      billed += fa;
      return {
        id: s.id,
        createdAt: s.createdAt,
        numbers: s.numbers,
        totalNumbers: s.totalNumbers,
        finalAmount: fa,
        amountPaid: ap,
        debt: round2(fa - ap),
        status: s.status,
        contactName: s.contact?.name ?? "—",
        raffleTitle: s.raffle?.title ?? "",
        commission: round2((ap * rate) / 100),
      };
    });

    return {
      rate,
      items,
      totals: {
        count: sales.length,
        collected: round2(collected),
        billed: round2(billed),
        commission: round2((collected * rate) / 100),
      },
    };
  }),

  // Números EN VIVO de una rifa del negocio (para que el vendedor sepa qué vender).
  numbers: vendorProcedure
    .input(z.object({ raffleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: ctx.businessId },
        select: { id: true, title: true, pricePerNumber: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada" });

      const numbers = await ctx.prisma.raffleNumber.findMany({
        where: { raffleId: raffle.id },
        select: { number: true, status: true },
        orderBy: { number: "asc" },
      });
      const available = numbers.filter((n) => n.status === "AVAILABLE").length;
      return {
        raffle: { id: raffle.id, title: raffle.title, pricePerNumber: Number(raffle.pricePerNumber) },
        total: numbers.length,
        available,
        numbers,
      };
    }),

  // El vendedor registra una venta a su nombre (vendorId = él). Cobra su abono.
  registerSale: vendorProcedure
    .input(
      z.object({
        raffleId: z.string(),
        numbers: z.array(z.string()).min(1, "Elige al menos un número"),
        name: z.string().min(2, "Nombre requerido"),
        phone: z.string().min(7, "Teléfono requerido"),
        paymentMethod: z.nativeEnum(PaymentMethod),
        amountPaid: z.number().nonnegative().optional(),
        paymentReference: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const businessId = ctx.businessId;

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: businessId, status: "ACTIVE" },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no disponible" });

      // La disponibilidad se garantiza con la RESERVA ATÓMICA de más abajo.

      // Cliente del negocio (la exclusividad del vendedor es por vendorId en la venta).
      const contact = await prisma.contact.upsert({
        where: { userId_phone: { userId: businessId, phone: input.phone } },
        update: { name: input.name },
        create: { userId: businessId, name: input.name, phone: input.phone, source: "vendor" },
      });

      const totalAmount = Number(raffle.pricePerNumber) * input.numbers.length;
      const finalAmount = round2(totalAmount);
      const amountPaid = round2(Math.min(Math.max(input.amountPaid ?? finalAmount, 0), finalAmount));
      const isFullyPaid = amountPaid >= finalAmount;
      const saleStatus = isFullyPaid ? "PAID" : amountPaid > 0 ? "RESERVED" : "PENDING";
      const numberStatus = isFullyPaid ? "PAID" : "RESERVED";

      const activeRate = await getActiveRate(prisma, businessId);
      const rateUsed = activeRate ? Number(activeRate.vesPerUsd) : null;
      const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${ctx.vendor.id.slice(-3).toUpperCase()}`;

      // RESERVA ATÓMICA (anti doble-venta): toma SOLO los AVAILABLE, etiquetados con
      // receiptNumber. Si no alcanza, revierte lo de ESTE request y aborta.
      const claim = await prisma.raffleNumber.updateMany({
        where: { raffleId: raffle.id, number: { in: input.numbers }, status: "AVAILABLE" },
        data: { status: numberStatus, soldAt: new Date(), paidAt: isFullyPaid ? new Date() : null, paymentMethod: input.paymentMethod, receiptNumber },
      });
      if (claim.count !== input.numbers.length) {
        await prisma.raffleNumber.updateMany({
          where: { raffleId: raffle.id, number: { in: input.numbers }, receiptNumber, saleId: null },
          data: { status: "AVAILABLE", soldAt: null, paidAt: null, paymentMethod: null, receiptNumber: null },
        });
        throw new TRPCError({ code: "CONFLICT", message: "Algún número ya no está disponible" });
      }

      const sale = await prisma.sale.create({
        data: {
          raffleId: raffle.id,
          contactId: contact.id,
          userId: businessId,
          vendorId: ctx.vendor.id,
          numbers: input.numbers,
          totalNumbers: input.numbers.length,
          totalAmount,
          finalAmount,
          amountPaid,
          rateUsed: rateUsed ?? undefined,
          amountVes: rateUsed ? round2(finalAmount * rateUsed) : undefined,
          status: saleStatus,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          paidAt: isFullyPaid ? new Date() : undefined,
          receiptNumber,
          source: "vendor",
        },
      });

      if (amountPaid > 0) {
        await prisma.payment.create({
          data: { saleId: sale.id, amount: amountPaid, method: input.paymentMethod, reference: input.paymentReference, status: "CONFIRMED" },
        });
      }

      // Vincular los números YA reclamados (status/soldAt fijados por el reclamo atómico).
      await prisma.raffleNumber.updateMany({
        where: { raffleId: raffle.id, number: { in: input.numbers }, receiptNumber },
        data: { contactId: contact.id, saleId: sale.id, vendorId: ctx.vendor.id },
      });
      await prisma.contact.update({
        where: { id: contact.id },
        data: { totalSpent: { increment: amountPaid }, totalTickets: { increment: input.numbers.length }, totalRaffles: { increment: 1 }, lastPurchase: new Date() },
      });
      await prisma.raffle.update({ where: { id: raffle.id }, data: { soldCount: { increment: input.numbers.length }, revenue: { increment: amountPaid } } });

      await emitReceipt(prisma, businessId, sale.id);
      return { saleId: sale.id, status: saleStatus, amountPaid, debt: round2(finalAmount - amountPaid) };
    }),

  // Cobrar/abonar una venta — SOLO si es del propio vendedor (regla del negocio).
  addPayment: vendorProcedure
    .input(
      z.object({
        saleId: z.string(),
        amount: z.number().positive(),
        paymentMethod: z.nativeEnum(PaymentMethod),
        reference: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const sale = await prisma.sale.findFirst({
        where: { id: input.saleId, vendorId: ctx.vendor.id },
      });
      if (!sale) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo puedes cobrar tus propias ventas" });
      }
      if (sale.status === "CANCELLED" || sale.status === "REFUNDED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La venta está cancelada" });
      }

      const finalAmount = Number(sale.finalAmount);
      const remaining = round2(finalAmount - Number(sale.amountPaid));
      if (remaining <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "La venta ya está saldada" });
      const applied = round2(Math.min(input.amount, remaining));

      await prisma.payment.create({
        data: { saleId: sale.id, amount: applied, method: input.paymentMethod, reference: input.reference, status: "CONFIRMED" },
      });
      const agg = await prisma.payment.aggregate({ _sum: { amount: true }, where: { saleId: sale.id, status: "CONFIRMED" } });
      const amountPaid = round2(Number(agg._sum.amount ?? 0));
      const isFullyPaid = amountPaid >= finalAmount;

      await prisma.sale.update({
        where: { id: sale.id },
        data: { amountPaid, status: isFullyPaid ? "PAID" : "RESERVED", paymentMethod: input.paymentMethod, paidAt: isFullyPaid ? new Date() : sale.paidAt ?? undefined },
      });
      if (isFullyPaid) {
        await prisma.raffleNumber.updateMany({ where: { saleId: sale.id }, data: { status: "PAID", paidAt: new Date() } });
      }
      await prisma.contact.update({ where: { id: sale.contactId }, data: { totalSpent: { increment: applied }, lastPurchase: new Date() } });
      await prisma.raffle.update({ where: { id: sale.raffleId }, data: { revenue: { increment: applied } } });

      await emitReceipt(prisma, ctx.businessId, sale.id);
      return { amountPaid, debt: round2(finalAmount - amountPaid), isFullyPaid };
    }),
});
