import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { generateReceipt } from "@riffas/shared/receipt";
import { PaymentMethod } from "@riffas/db";

// Redondeo a 2 decimales para montos de dinero.
const round2 = (n: number) => Math.round(n * 100) / 100;

// La marca del rifero NO viaja en la sesión (solo id/name/email/image), así que
// la leemos de la DB para que el recibo aplique nombre/color/logo correctos.
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

export const saleRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        raffleId: z.string(),
        contactId: z.string().optional(),
        contactData: z.object({
          name: z.string().min(1),
          phone: z.string().min(8),
          email: z.string().email().optional(),
          city: z.string().optional(),
        }).optional(),
        numbers: z.array(z.string()).min(1),
        vendorId: z.string().optional(),
        // Todos los metodos (incluye los venezolanos: PAGO_MOVIL, BINANCE, ZELLE, etc.)
        paymentMethod: z.nativeEnum(PaymentMethod),
        // Abono inicial. Si se omite => venta completa (paga el total).
        // Si es 0 < x < total => apartado con abono parcial (queda deuda).
        amountPaid: z.number().nonnegative().optional(),
        paymentReference: z.string().optional(),
        paymentProof: z.string().optional(),
        discountCode: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: session.user.id, status: "ACTIVE" },
        include: { numbers: true },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada o inactiva" });

      const requestedNumbers = await prisma.raffleNumber.findMany({
        where: {
          raffleId: input.raffleId,
          number: { in: input.numbers },
        },
      });

      const unavailable = requestedNumbers.filter((n) => n.status !== "AVAILABLE");
      if (unavailable.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Números no disponibles: ${unavailable.map((n) => n.number).join(", ")}`,
        });
      }

      let contactId = input.contactId;
      if (!contactId && input.contactData) {
        const existing = await prisma.contact.findFirst({
          where: { userId: session.user.id, phone: input.contactData.phone },
        });

        if (existing) {
          contactId = existing.id;
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              name: input.contactData.name,
              email: input.contactData.email || existing.email,
              city: input.contactData.city || existing.city,
              lastContactDate: new Date(),
              lastContactMethod: "sale",
            },
          });
        } else {
          const newContact = await prisma.contact.create({
            data: {
              ...input.contactData,
              userId: session.user.id,
              source: "manual",
              lastContactDate: new Date(),
              lastContactMethod: "sale",
            },
          });
          contactId = newContact.id;
        }
      }

      if (!contactId) throw new TRPCError({ code: "BAD_REQUEST", message: "Contacto requerido" });

      let totalAmount = Number(raffle.pricePerNumber) * input.numbers.length;
      let discountApplied = 0;

      if (raffle.discountPackages) {
        const packages = raffle.discountPackages as Array<{ qty: number; discountPercent: number }>;
        const applicable = packages
          .filter((p) => input.numbers.length >= p.qty)
          .sort((a, b) => b.discountPercent - a.discountPercent)[0];

        if (applicable) {
          discountApplied = totalAmount * (applicable.discountPercent / 100);
        }
      }

      const finalAmount = round2(totalAmount - discountApplied);

      // Abono inicial: si no se especifica, se asume venta completa.
      // Se acota a [0, finalAmount] (no se permite sobrepago en la creacion).
      const requestedPaid =
        input.amountPaid === undefined ? finalAmount : input.amountPaid;
      const amountPaid = round2(Math.min(Math.max(requestedPaid, 0), finalAmount));
      const debt = round2(finalAmount - amountPaid);
      const isFullyPaid = amountPaid >= finalAmount;

      // Venta completa => PAID. Abono parcial (>0) => RESERVED (apartado).
      // Sin abono => PENDING. Los numeros se reservan hasta saldar.
      const saleStatus = isFullyPaid ? "PAID" : amountPaid > 0 ? "RESERVED" : "PENDING";
      const numberStatus = isFullyPaid ? "PAID" : "RESERVED";

      const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      const sale = await prisma.sale.create({
        data: {
          raffleId: input.raffleId,
          contactId,
          vendorId: input.vendorId,
          userId: session.user.id,
          numbers: input.numbers,
          totalNumbers: input.numbers.length,
          totalAmount,
          discountApplied: discountApplied || undefined,
          finalAmount,
          amountPaid,
          status: saleStatus,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          paymentProof: input.paymentProof,
          paidAt: isFullyPaid ? new Date() : undefined,
          receiptNumber,
          source: input.vendorId ? "vendor" : "direct",
        },
        include: {
          contact: true,
          raffle: true,
        },
      });

      // Registrar el abono inicial como Payment real (fuente de verdad del ledger).
      if (amountPaid > 0) {
        await prisma.payment.create({
          data: {
            saleId: sale.id,
            amount: amountPaid,
            method: input.paymentMethod,
            reference: input.paymentReference,
            proofUrl: input.paymentProof,
            status: "CONFIRMED",
          },
        });
      }

      await prisma.raffleNumber.updateMany({
        where: {
          raffleId: input.raffleId,
          number: { in: input.numbers },
        },
        data: {
          status: numberStatus,
          contactId,
          saleId: sale.id,
          vendorId: input.vendorId,
          soldAt: new Date(),
          paidAt: isFullyPaid ? new Date() : undefined,
          paymentMethod: input.paymentMethod,
          receiptNumber,
        },
      });

      await prisma.contact.update({
        where: { id: contactId },
        data: {
          // Solo lo realmente cobrado (el abono), no el total adeudado.
          totalSpent: { increment: amountPaid },
          totalTickets: { increment: input.numbers.length },
          totalRaffles: { increment: 1 },
          lastPurchase: new Date(),
        },
      });

      await prisma.raffle.update({
        where: { id: input.raffleId },
        data: {
          soldCount: { increment: input.numbers.length },
          revenue: { increment: amountPaid },
        },
      });

      const receiptUrl = await generateReceipt({
        sale, // incluye amountPaid => el recibo muestra Valor total / Abonado / Deuda reales
        raffle,
        contact: sale.contact,
        ...(await brandFor(prisma, session.user.id)),
      });

      await prisma.sale.update({
        where: { id: sale.id },
        data: { receiptUrl },
      });

      await prisma.raffleNumber.updateMany({
        where: { saleId: sale.id },
        data: { receiptUrl },
      });

      return { sale: { ...sale, receiptUrl }, amountPaid, debt, isFullyPaid };
    }),

  // Registra un abono posterior contra una venta apartada y recalcula la deuda.
  addPayment: protectedProcedure
    .input(
      z.object({
        saleId: z.string(),
        amount: z.number().positive(),
        paymentMethod: z.nativeEnum(PaymentMethod),
        reference: z.string().optional(),
        proofUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      const sale = await prisma.sale.findFirst({
        where: { id: input.saleId, userId: session.user.id },
        include: { contact: true, raffle: true },
      });
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });
      if (sale.status === "CANCELLED" || sale.status === "REFUNDED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La venta esta cancelada/reembolsada" });
      }

      const finalAmount = Number(sale.finalAmount);
      const already = Number(sale.amountPaid);
      const remaining = round2(finalAmount - already);
      if (remaining <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La venta ya esta saldada" });
      }

      // No permitir sobrepago: el abono se acota al saldo pendiente.
      const applied = round2(Math.min(input.amount, remaining));

      await prisma.payment.create({
        data: {
          saleId: sale.id,
          amount: applied,
          method: input.paymentMethod,
          reference: input.reference,
          proofUrl: input.proofUrl,
          status: "CONFIRMED",
        },
      });

      // Recalcular el cache desde la fuente de verdad (suma de pagos CONFIRMED).
      const agg = await prisma.payment.aggregate({
        _sum: { amount: true },
        where: { saleId: sale.id, status: "CONFIRMED" },
      });
      const amountPaid = round2(Number(agg._sum.amount ?? 0));
      const debt = round2(finalAmount - amountPaid);
      const isFullyPaid = amountPaid >= finalAmount;

      const updated = await prisma.sale.update({
        where: { id: sale.id },
        data: {
          amountPaid,
          status: isFullyPaid ? "PAID" : "RESERVED",
          paymentMethod: input.paymentMethod,
          paidAt: isFullyPaid ? new Date() : sale.paidAt ?? undefined,
        },
        include: { contact: true, raffle: true },
      });

      if (isFullyPaid) {
        await prisma.raffleNumber.updateMany({
          where: { saleId: sale.id },
          data: { status: "PAID", paidAt: new Date() },
        });
      }

      await prisma.contact.update({
        where: { id: sale.contactId },
        data: { totalSpent: { increment: applied }, lastPurchase: new Date() },
      });
      await prisma.raffle.update({
        where: { id: sale.raffleId },
        data: { revenue: { increment: applied } },
      });

      // Regenerar el recibo con los montos reales actualizados (overwrite en Cloudinary).
      const receiptUrl = await generateReceipt({
        sale: updated,
        raffle: updated.raffle,
        contact: updated.contact,
        ...(await brandFor(prisma, session.user.id)),
      });
      await prisma.sale.update({ where: { id: sale.id }, data: { receiptUrl } });
      await prisma.raffleNumber.updateMany({
        where: { saleId: sale.id },
        data: { receiptUrl },
      });

      return { sale: { ...updated, receiptUrl }, amountPaid, debt, isFullyPaid };
    }),

  // Marca una venta como saldada por completo: registra el saldo pendiente como
  // un Payment CONFIRMED y deja amountPaid == finalAmount.
  confirmPayment: protectedProcedure
    .input(
      z.object({
        saleId: z.string(),
        paymentMethod: z.nativeEnum(PaymentMethod).optional(),
        paymentProof: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      const current = await prisma.sale.findFirst({
        where: { id: input.saleId, userId: session.user.id },
      });
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });

      const finalAmount = Number(current.finalAmount);
      const remaining = round2(finalAmount - Number(current.amountPaid));

      if (remaining > 0) {
        await prisma.payment.create({
          data: {
            saleId: current.id,
            amount: remaining,
            method: input.paymentMethod ?? current.paymentMethod ?? "CASH",
            proofUrl: input.paymentProof,
            status: "CONFIRMED",
          },
        });
        await prisma.contact.update({
          where: { id: current.contactId },
          data: { totalSpent: { increment: remaining }, lastPurchase: new Date() },
        });
        await prisma.raffle.update({
          where: { id: current.raffleId },
          data: { revenue: { increment: remaining } },
        });
      }

      const sale = await prisma.sale.update({
        where: { id: input.saleId },
        data: {
          status: "PAID",
          amountPaid: finalAmount,
          paidAt: new Date(),
          paymentProof: input.paymentProof ?? undefined,
          paymentMethod: input.paymentMethod ?? undefined,
        },
        include: { contact: true, raffle: true },
      });

      await prisma.raffleNumber.updateMany({
        where: { saleId: input.saleId },
        data: { status: "PAID", paidAt: new Date() },
      });

      return sale;
    }),

  list: protectedProcedure
    .input(
      z.object({
        raffleId: z.string().optional(),
        contactId: z.string().optional(),
        status: z.enum(["ALL", "PENDING", "RESERVED", "PAID", "CANCELLED", "REFUNDED"]).optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { prisma, session } = ctx;
      const { raffleId, contactId, status = "ALL", startDate, endDate, limit = 20, cursor } = input || {};

      const where: any = { userId: session.user.id };
      if (raffleId) where.raffleId = raffleId;
      if (contactId) where.contactId = contactId;
      if (status !== "ALL") where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }

      const sales = await prisma.sale.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          raffle: { select: { id: true, title: true } },
          vendor: { select: { id: true, name: true, code: true } },
        },
      });

      let nextCursor: typeof cursor | undefined = undefined;
      if (sales.length > limit) {
        const nextItem = sales.pop();
        nextCursor = nextItem!.id;
      }

      return { sales, nextCursor };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const sale = await ctx.prisma.sale.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          contact: true,
          raffle: true,
          vendor: true,
          numbers_rel: true,
          payments: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      return sale;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sale = await ctx.prisma.sale.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { status: "CANCELLED" },
      });

      await ctx.prisma.raffleNumber.updateMany({
        where: { saleId: input.id },
        data: {
          status: "AVAILABLE",
          contactId: null,
          saleId: null,
          soldAt: null,
          paidAt: null,
          paymentMethod: null,
          receiptUrl: null,
          receiptNumber: null,
        },
      });

      return sale;
    }),

  resendReceipt: protectedProcedure
    .input(z.object({ saleId: z.string(), channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]) }))
    .mutation(async ({ ctx, input }) => {
      const sale = await ctx.prisma.sale.findFirst({
        where: { id: input.saleId, userId: ctx.session.user.id },
        include: { contact: true, raffle: true },
      });

      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });

      const updateData: any = {};
      if (input.channel === "WHATSAPP") {
        updateData.whatsappSent = true;
        updateData.whatsappSentAt = new Date();
      } else if (input.channel === "EMAIL") {
        updateData.emailSent = true;
        updateData.emailSentAt = new Date();
      } else {
        updateData.smsSent = true;
        updateData.smsSentAt = new Date();
      }

      await ctx.prisma.sale.update({
        where: { id: input.saleId },
        data: updateData,
      });

      return { success: true };
    }),
});
