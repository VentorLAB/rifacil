import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { PaymentMethod } from "@riffas/db";
import { normalizePhone } from "@riffas/shared";
import { uploadImage } from "@riffas/shared/cloudinary";
import { getActiveRate } from "../lib/exchangeRate";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Enmascara el nombre para no exponer datos completos al verificar por boleto.
// "Juan Pérez" -> "Ju** P****"
function maskName(name: string): string {
  return (name || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "*".repeat(Math.min(4, w.length - 2))))
    .join(" ");
}

// Carga diferida del recibo (binarios nativos satori/resvg) — igual que en sale.ts,
// para no tumbar la API al iniciar y tolerar el fallo del render.
type ReceiptArgs = Parameters<typeof import("@riffas/shared/receipt")["generateReceipt"]>[0];
async function safeGenerateReceipt(args: ReceiptArgs): Promise<string | null> {
  try {
    const { generateReceipt } = await import("@riffas/shared/receipt");
    return await generateReceipt(args);
  } catch (err) {
    console.error("[public] generateReceipt falló; la venta se guardó sin recibo:", err);
    return null;
  }
}

export const publicRouter = createTRPCRouter({
  // Datos públicos de la rifa para la tienda (/r/[id]). Sin login.
  getRaffle: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.id, isPublic: true, status: { not: "CANCELLED" } },
        include: {
          user: {
            select: {
              name: true,
              brandName: true,
              brandLogo: true,
              brandColor: true,
              paymentAccounts: { where: { active: true }, orderBy: { method: "asc" } },
            },
          },
          prizes: {
            orderBy: { orden: "asc" },
            select: { titulo: true, descripcion: true, imagenUrl: true },
          },
        },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const grouped = await ctx.prisma.raffleNumber.groupBy({
        by: ["status"],
        where: { raffleId: raffle.id },
        _count: { _all: true },
      });
      const byStatus: Record<string, number> = { AVAILABLE: 0, RESERVED: 0, SOLD: 0, PAID: 0 };
      for (const g of grouped) byStatus[g.status] = g._count._all;
      const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
      const soldCount = byStatus.SOLD + byStatus.PAID;
      const soldPct = total > 0 ? Math.round((soldCount / total) * 1000) / 10 : 0;

      await ctx.prisma.raffle
        .update({ where: { id: raffle.id }, data: { viewCount: { increment: 1 } } })
        .catch(() => {});

      return {
        id: raffle.id,
        title: raffle.title,
        description: raffle.description,
        color: raffle.color || raffle.user.brandColor || "#7c3aed",
        bannerUrl: raffle.bannerUrl,
        bannerMobileUrl: raffle.bannerMobileUrl,
        iconUrl: raffle.iconUrl,
        pricePerNumber: Number(raffle.pricePerNumber),
        totalNumbers: raffle.totalNumbers,
        loteria: raffle.loteria,
        drawDate: raffle.drawDate,
        contactWhatsapp: raffle.contactWhatsapp,
        status: raffle.status,
        canBuy: raffle.status === "ACTIVE",
        counts: {
          total,
          available: byStatus.AVAILABLE,
          reserved: byStatus.RESERVED,
          sold: byStatus.SOLD,
          paid: byStatus.PAID,
        },
        soldPct,
        prizes: raffle.prizes,
        brand: {
          name: raffle.user.brandName || raffle.user.name || "Rifa",
          logo: raffle.user.brandLogo,
          color: raffle.user.brandColor,
        },
        paymentAccounts: raffle.user.paymentAccounts.map((a) => ({
          method: a.method,
          bankName: a.bankName,
          phone: a.phone,
          idDocument: a.idDocument,
          email: a.email,
          wallet: a.wallet,
          holderName: a.holderName,
          accountNumber: a.accountNumber,
          note: a.note,
        })),
      };
    }),

  // Tablero de números (público): solo número + estado, NUNCA datos del comprador.
  listNumbers: publicProcedure
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
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.raffleId, isPublic: true },
        select: { id: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const where: any = { raffleId: input.raffleId };
      if (input.status !== "ALL") where.status = input.status;
      const search = input.search?.trim();
      if (search) where.number = { contains: search };

      const [total, numbers] = await Promise.all([
        ctx.prisma.raffleNumber.count({ where }),
        ctx.prisma.raffleNumber.findMany({
          where,
          orderBy: { number: "asc" },
          skip: input.page * input.pageSize,
          take: input.pageSize,
          select: { id: true, number: true, status: true },
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

  // Verificar mis números: por teléfono o por número de boleto. Solo lectura.
  // Da confianza al comprador sin exponer datos de otros (nombre enmascarado).
  verify: publicProcedure
    .input(z.object({ raffleId: z.string(), query: z.string().min(2) }))
    .query(async ({ ctx, input }) => {
      const raffle = await ctx.prisma.raffle.findFirst({
        where: { id: input.raffleId, isPublic: true },
        select: { id: true, userId: true },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND" });

      const q = input.query.trim();
      let contactId: string | null = null;

      // 1) Intento por teléfono (normalizado a VE).
      const phone = normalizePhone(q, "VE");
      if (phone) {
        const c = await ctx.prisma.contact.findFirst({
          where: { userId: raffle.userId, phone },
          select: { id: true },
        });
        if (c) contactId = c.id;
      }

      // 2) Intento por número de boleto asignado en esta rifa.
      if (!contactId) {
        const rn = await ctx.prisma.raffleNumber.findFirst({
          where: { raffleId: raffle.id, number: q, contactId: { not: null } },
          select: { contactId: true },
        });
        if (rn?.contactId) contactId = rn.contactId;
      }

      if (!contactId) {
        return { found: false, holder: null, totals: { numbers: 0, abonado: 0, deuda: 0 }, items: [] };
      }

      const contact = await ctx.prisma.contact.findUnique({
        where: { id: contactId },
        select: { name: true },
      });
      const numbers = await ctx.prisma.raffleNumber.findMany({
        where: { raffleId: raffle.id, contactId },
        orderBy: { number: "asc" },
        select: {
          number: true,
          status: true,
          sale: { select: { amountPaid: true, finalAmount: true, totalNumbers: true } },
        },
      });

      const STATUS_ES: Record<string, string> = {
        RESERVED: "Apartado",
        SOLD: "Por confirmar",
        PAID: "Pagado",
        AVAILABLE: "Disponible",
      };
      let abonadoSum = 0;
      let deudaSum = 0;
      const items = numbers.map((n) => {
        // Abonado/Deuda prorrateados por número (una venta puede cubrir varios).
        const count = n.sale?.totalNumbers && n.sale.totalNumbers > 0 ? n.sale.totalNumbers : 1;
        const ab = n.sale ? round2(Number(n.sale.amountPaid) / count) : 0;
        const de = n.sale
          ? Math.max(0, round2((Number(n.sale.finalAmount) - Number(n.sale.amountPaid)) / count))
          : 0;
        abonadoSum += ab;
        deudaSum += de;
        return { number: n.number, estado: STATUS_ES[n.status] ?? n.status, abonado: ab, deuda: de };
      });

      return {
        found: items.length > 0,
        holder: contact ? maskName(contact.name) : null,
        totals: { numbers: items.length, abonado: round2(abonadoSum), deuda: round2(deudaSum) },
        items,
      };
    }),

  // Sube el comprobante de pago (captura) a Cloudinary. Sin login.
  uploadProof: publicProcedure
    .input(
      z.object({
        dataUri: z.string().refine((v) => v.startsWith("data:image/"), "Debe ser una imagen"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const url = await uploadImage(input.dataUri, { folder: "riffas/proofs" });
        return { url };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo subir el comprobante. Intenta de nuevo.",
        });
      }
    }),

  // El comprador aparta número(s) → venta "por confirmar" (PENDING). Sin login.
  createSale: publicProcedure
    .input(
      z.object({
        raffleId: z.string(),
        numbers: z.array(z.string()).min(1, "Elige al menos un número"),
        name: z.string().min(2, "Nombre requerido"),
        phone: z.string().min(7, "Teléfono requerido"),
        paymentMethod: z.nativeEnum(PaymentMethod),
        amountPaid: z.number().nonnegative().optional(),
        paymentReference: z.string().optional(),
        paymentProof: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      const raffle = await prisma.raffle.findFirst({
        where: { id: input.raffleId, isPublic: true, status: "ACTIVE" },
      });
      if (!raffle) throw new TRPCError({ code: "NOT_FOUND", message: "Rifa no disponible" });
      const userId = raffle.userId;

      const phone = normalizePhone(input.phone, "VE");
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Teléfono inválido" });

      // Disponibilidad de los números solicitados.
      const requested = await prisma.raffleNumber.findMany({
        where: { raffleId: raffle.id, number: { in: input.numbers } },
      });
      if (requested.length !== input.numbers.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Algún número no existe" });
      }
      const taken = requested.filter((n) => n.status !== "AVAILABLE");
      if (taken.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya no disponibles: ${taken.map((n) => n.number).join(", ")}`,
        });
      }

      // Cliente del rifero (upsert por teléfono).
      const contact = await prisma.contact.upsert({
        where: { userId_phone: { userId, phone } },
        update: { name: input.name },
        create: { userId, name: input.name, phone, source: "public" },
      });

      // Precio (con paquetes de descuento, si aplican).
      const totalAmount = Number(raffle.pricePerNumber) * input.numbers.length;
      let discountApplied = 0;
      if (raffle.discountPackages) {
        const pkgs = raffle.discountPackages as Array<{ qty: number; discountPercent: number }>;
        const ap = pkgs
          .filter((p) => input.numbers.length >= p.qty)
          .sort((a, b) => b.discountPercent - a.discountPercent)[0];
        if (ap) discountApplied = totalAmount * (ap.discountPercent / 100);
      }
      const finalAmount = round2(totalAmount - discountApplied);
      const declared = round2(Math.min(Math.max(input.amountPaid ?? finalAmount, 0), finalAmount));

      const activeRate = await getActiveRate(prisma, userId);
      const rateUsed = activeRate ? Number(activeRate.vesPerUsd) : null;
      const amountVes = rateUsed ? round2(finalAmount * rateUsed) : null;

      const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      const sale = await prisma.sale.create({
        data: {
          raffleId: raffle.id,
          contactId: contact.id,
          userId,
          numbers: input.numbers,
          totalNumbers: input.numbers.length,
          totalAmount,
          discountApplied: discountApplied || undefined,
          finalAmount,
          amountPaid: declared, // reportado por el comprador (a confirmar por el rifero)
          rateUsed: rateUsed ?? undefined,
          amountVes: amountVes ?? undefined,
          status: "PENDING", // por confirmar
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          paymentProof: input.paymentProof,
          receiptNumber,
          source: "public",
        },
        include: { contact: true, raffle: true },
      });

      // Abono REPORTADO (PENDING): el rifero lo confirma luego en el panel.
      if (declared > 0) {
        await prisma.payment.create({
          data: {
            saleId: sale.id,
            amount: declared,
            method: input.paymentMethod,
            reference: input.paymentReference,
            proofUrl: input.paymentProof,
            status: "PENDING",
          },
        });
      }

      // Números -> SOLD ("por confirmar").
      await prisma.raffleNumber.updateMany({
        where: { raffleId: raffle.id, number: { in: input.numbers } },
        data: {
          status: "SOLD",
          contactId: contact.id,
          saleId: sale.id,
          soldAt: new Date(),
          paymentMethod: input.paymentMethod,
          receiptNumber,
        },
      });

      // No tocamos revenue ni totalSpent: el dinero aún no está confirmado.
      await prisma.contact.update({
        where: { id: contact.id },
        data: { totalTickets: { increment: input.numbers.length }, lastPurchase: new Date() },
      });
      await prisma.raffle.update({
        where: { id: raffle.id },
        data: { soldCount: { increment: input.numbers.length } },
      });

      // Recibo.
      const prizes = await prisma.prize.findMany({
        where: { raffleId: raffle.id },
        orderBy: { orden: "asc" },
        select: { titulo: true },
      });
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, brandName: true, brandColor: true, brandLogo: true },
      });
      const receiptUrl = await safeGenerateReceipt({
        sale,
        raffle: { title: raffle.title, lottery: raffle.loteria, drawDate: raffle.drawDate, prizes },
        contact: sale.contact,
        brandName: u?.brandName || u?.name || "Rifa",
        brandColor: raffle.color || u?.brandColor || null,
        brandLogo: u?.brandLogo || null,
      });
      await prisma.sale.update({ where: { id: sale.id }, data: { receiptUrl } });
      if (receiptUrl) {
        await prisma.raffleNumber.updateMany({ where: { saleId: sale.id }, data: { receiptUrl } });
      }

      return {
        saleId: sale.id,
        receiptNumber,
        receiptUrl,
        numbers: input.numbers,
        finalAmount,
        amountPaid: declared,
        debt: round2(finalAmount - declared),
      };
    }),
});
