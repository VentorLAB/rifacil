import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { PaymentMethod } from "@riffas/db";
import { getActiveRate } from "../lib/exchangeRate";

// Redondeo a 2 decimales para montos de dinero.
const round2 = (n: number) => Math.round(n * 100) / 100;

// Carga DIFERIDA del generador de recibos. receipt.ts importa satori + @resvg/resvg-js
// (binarios nativos) en su top-level. Si se importa en el top-level de este router,
// cargar appRouter arrastra el binario nativo y —si no quedó trazado en el lambda de
// Vercel— TODA la API tRPC crashea al iniciar ("Cannot find module ...resvg..."), lo que
// tumbaba rifas, contactos, vendedores, etc. Lo importamos solo al generar el recibo y
// toleramos el fallo: la venta/abono se guarda aunque el recibo no se pueda renderizar.
type ReceiptArgs = Parameters<typeof import("@riffas/shared/receipt")["generateReceipt"]>[0];

async function safeGenerateReceipt(args: ReceiptArgs): Promise<string | null> {
  try {
    const { generateReceipt } = await import("@riffas/shared/receipt");
    return await generateReceipt(args);
  } catch (err) {
    console.error("[sale] generateReceipt falló; la venta se guardó sin recibo:", err);
    return null;
  }
}

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
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.raffleId, userId: businessId, status: "ACTIVE" },
        include: { numbers: true },
      });

      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no encontrada o inactiva" });

      // La disponibilidad se garantiza con la RESERVA ATÓMICA de más abajo
      // (UPDATE condicional por receiptNumber), no con check-then-update (race).

      let contactId = input.contactId;
      if (!contactId && input.contactData) {
        const existing = await prisma.contact.findFirst({
          where: { userId, phone: input.contactData.phone },
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
              userId,
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

      // RESERVA ATÓMICA (anti doble-venta): toma SOLO los AVAILABLE en un único
      // UPDATE condicional, etiquetados con receiptNumber. Si no alcanza, revierte
      // lo que tomó ESTE request y aborta.
      const claim = await prisma.raffleNumber.updateMany({
        where: { raffleId: input.raffleId, number: { in: input.numbers }, status: "AVAILABLE" },
        data: {
          status: numberStatus,
          soldAt: new Date(),
          paidAt: isFullyPaid ? new Date() : null,
          paymentMethod: input.paymentMethod,
          receiptNumber,
        },
      });
      if (claim.count !== input.numbers.length) {
        await prisma.raffleNumber.updateMany({
          where: { raffleId: input.raffleId, number: { in: input.numbers }, receiptNumber, saleId: null },
          data: { status: "AVAILABLE", soldAt: null, paidAt: null, paymentMethod: null, receiptNumber: null },
        });
        throw new TRPCError({ code: "CONFLICT", message: "Algún número ya no está disponible" });
      }

      // Tasa activa del rifero: congela el equivalente en Bs al momento de la venta.
      const activeRate = await getActiveRate(prisma, businessId);
      const rateUsed = activeRate ? Number(activeRate.vesPerUsd) : null;
      const amountVes = rateUsed ? round2(finalAmount * rateUsed) : null;

      const sale = await prisma.sale.create({
        data: {
          raffleId: input.raffleId,
          contactId,
          vendorId: input.vendorId,
          userId: businessId,
          numbers: input.numbers,
          totalNumbers: input.numbers.length,
          totalAmount,
          discountApplied: discountApplied || undefined,
          finalAmount,
          amountPaid,
          rateUsed: rateUsed ?? undefined,
          amountVes: amountVes ?? undefined,
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

      // Vincular los números YA reclamados a la venta/cliente (status/soldAt ya
      // fijados por el reclamo atómico; aquí solo saleId/contactId/vendorId).
      await prisma.raffleNumber.updateMany({
        where: { raffleId: input.raffleId, number: { in: input.numbers }, receiptNumber },
        data: { contactId, saleId: sale.id, vendorId: input.vendorId },
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

      const prizes = await prisma.prize.findMany({
        where: { raffleId: raffle.id },
        orderBy: { orden: "asc" },
        select: { titulo: true },
      });
      const brand = await brandFor(prisma, businessId);
      const receiptUrl = await safeGenerateReceipt({
        sale, // incluye amountPaid => el recibo muestra Valor total / Abonado / Deuda reales
        raffle: {
          title: raffle.title,
          lottery: raffle.loteria,
          drawDate: raffle.drawDate,
          prizes,
        },
        contact: sale.contact,
        ...brand,
      });

      await prisma.sale.update({
        where: { id: sale.id },
        data: { receiptUrl },
      });

      await prisma.raffleNumber.updateMany({
        where: { saleId: sale.id },
        data: { receiptUrl },
      });

      // El comprobante se envía por wa.me desde la UI (no Cloud API): la mutación
      // devuelve sale.contact + receiptUrl + brandName y el cliente arma el wa.me.
      return {
        sale: { ...sale, receiptUrl },
        amountPaid,
        debt,
        isFullyPaid,
        brandName: brand.brandName,
      };
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
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real

      const sale = await prisma.sale.findFirst({
        where: { id: input.saleId, userId: businessId },
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
      const prizes = await prisma.prize.findMany({
        where: { raffleId: updated.raffleId },
        orderBy: { orden: "asc" },
        select: { titulo: true },
      });
      const receiptUrl = await safeGenerateReceipt({
        sale: updated,
        raffle: {
          title: updated.raffle.title,
          lottery: updated.raffle.loteria,
          drawDate: updated.raffle.drawDate,
          prizes,
        },
        contact: updated.contact,
        ...(await brandFor(prisma, businessId)),
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
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real

      const current = await prisma.sale.findFirst({
        where: { id: input.saleId, userId: businessId },
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

  // --- Bandeja "Por confirmar" (ventas PENDING, p. ej. desde el storefront) ---

  listPending: protectedProcedure
    .input(z.object({ raffleId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real
      const where: any = { userId: businessId, status: "PENDING" };
      if (input?.raffleId) where.raffleId = input.raffleId;

      const sales = await prisma.sale.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          contact: { select: { name: true, phone: true } },
          raffle: { select: { id: true, title: true } },
          payments: {
            orderBy: { createdAt: "desc" },
            select: { amount: true, method: true, reference: true, proofUrl: true, status: true, createdAt: true },
          },
        },
      });
      return { sales };
    }),

  // Aprobar: confirma el pago reportado, pasa a pagado/apartado, emite recibo y audita.
  confirmSale: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real

      const sale = await prisma.sale.findFirst({
        where: { id: input.id, userId: businessId, status: "PENDING" },
        include: { contact: true, raffle: true },
      });
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada o ya procesada" });

      // Pagos reportados PENDING -> CONFIRMED.
      await prisma.payment.updateMany({
        where: { saleId: sale.id, status: "PENDING" },
        data: { status: "CONFIRMED" },
      });

      const agg = await prisma.payment.aggregate({
        where: { saleId: sale.id, status: "CONFIRMED" },
        _sum: { amount: true },
      });
      const amountPaid = round2(Number(agg._sum.amount ?? 0));
      const finalAmount = Number(sale.finalAmount);
      const isFullyPaid = amountPaid >= finalAmount;

      const updated = await prisma.sale.update({
        where: { id: sale.id },
        data: {
          amountPaid,
          status: isFullyPaid ? "PAID" : "RESERVED",
          paidAt: isFullyPaid ? new Date() : sale.paidAt ?? undefined,
        },
        include: { contact: true, raffle: true },
      });

      // Números: PAID si saldado, RESERVED (apartado) si abono parcial.
      await prisma.raffleNumber.updateMany({
        where: { saleId: sale.id },
        data: { status: isFullyPaid ? "PAID" : "RESERVED", paidAt: isFullyPaid ? new Date() : null },
      });

      // Ahora el dinero está confirmado → impacta métricas.
      await prisma.contact.update({
        where: { id: sale.contactId },
        data: { totalSpent: { increment: amountPaid }, lastPurchase: new Date() },
      });
      await prisma.raffle.update({
        where: { id: sale.raffleId },
        data: { revenue: { increment: amountPaid } },
      });

      // Recibo con montos confirmados.
      const prizes = await prisma.prize.findMany({
        where: { raffleId: sale.raffleId },
        orderBy: { orden: "asc" },
        select: { titulo: true },
      });
      const brand = await brandFor(prisma, businessId);
      const receiptUrl = await safeGenerateReceipt({
        sale: updated,
        raffle: {
          title: updated.raffle.title,
          lottery: updated.raffle.loteria,
          drawDate: updated.raffle.drawDate,
          prizes,
        },
        contact: updated.contact,
        ...brand,
      });
      await prisma.sale.update({ where: { id: sale.id }, data: { receiptUrl } });
      await prisma.raffleNumber.updateMany({ where: { saleId: sale.id }, data: { receiptUrl } });

      // El comprobante se reenvía por wa.me desde la UI (no Cloud API).
      // Auditoría: quién confirmó.
      await prisma.activityLog.create({
        data: {
          userId,
          action: "SALE_CONFIRMED",
          entityType: "Sale",
          entityId: sale.id,
          metadata: { amountPaid, isFullyPaid, receiptNumber: sale.receiptNumber },
        },
      });

      return { ...updated, receiptUrl, amountPaid, isFullyPaid };
    }),

  // Rechazar: libera los números (vuelven a disponibles), cancela la venta y audita.
  rejectSale: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real

      const sale = await prisma.sale.findFirst({
        where: { id: input.id, userId: businessId, status: "PENDING" },
      });
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada o ya procesada" });

      // Liberar los números.
      await prisma.raffleNumber.updateMany({
        where: { saleId: sale.id },
        data: {
          status: "AVAILABLE",
          contactId: null,
          saleId: null,
          vendorId: null,
          soldAt: null,
          paidAt: null,
          paymentMethod: null,
          receiptNumber: null,
          receiptUrl: null,
        },
      });

      // Pagos reportados -> RECHAZADOS.
      await prisma.payment.updateMany({
        where: { saleId: sale.id, status: "PENDING" },
        data: { status: "REJECTED" },
      });

      await prisma.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });

      // Revertir soldCount (la creación pública lo incrementó).
      await prisma.raffle.update({
        where: { id: sale.raffleId },
        data: { soldCount: { decrement: sale.totalNumbers } },
      });

      await prisma.activityLog.create({
        data: {
          userId,
          action: "SALE_REJECTED",
          entityType: "Sale",
          entityId: sale.id,
          metadata: { numbers: sale.numbers, receiptNumber: sale.receiptNumber },
        },
      });

      return { success: true };
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
      const { prisma } = ctx;
      const businessId = ctx.businessId; // rifas/ventas/config compartidas del negocio
      const userId = ctx.userId; // contactos y auditoría del usuario real
      const { raffleId, contactId, status = "ALL", startDate, endDate, limit = 20, cursor } = input || {};

      const where: any = { userId: businessId };
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
        where: { id: input.id, userId: ctx.businessId },
        include: {
          contact: true,
          raffle: true,
          vendor: true,
          numbers_rel: true,
          payments: { orderBy: { createdAt: "asc" } },
          user: { select: { brandName: true, name: true } },
        },
      });

      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      return sale;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sale = await ctx.prisma.sale.update({
        where: { id: input.id, userId: ctx.businessId },
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
        where: { id: input.saleId, userId: ctx.businessId },
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
