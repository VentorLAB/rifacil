import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

// Fase 1: CRUD de campañas + cálculo de destinatarios.
// El ENVÍO real por WhatsApp (Evolution API / Cloud API) llega en Fase 2.
export const campaignRouter = createTRPCRouter({
  health: publicProcedure.query(() => "ok"),

  list: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["DRAFT", "SCHEDULED", "SENDING", "SENT", "PAUSED", "CANCELLED"])
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const where: any = { userId: ctx.businessId };
      if (input?.status) where.status = input.status;

      const campaigns = await ctx.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      return { campaigns };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const campaign = await ctx.prisma.campaign.findFirst({
        where: { id: input.id, userId: ctx.businessId },
      });
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND" });
      return campaign;
    }),

  // Opciones para armar segmentos: etiquetas existentes + rifas del rifero.
  options: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.businessId;
    const contacts = await ctx.prisma.contact.findMany({
      where: { userId },
      select: { tags: true },
    });
    const tagSet = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => tagSet.add(t)));
    const raffles = await ctx.prisma.raffle.findMany({
      where: { userId },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    return { tags: [...tagSet].sort(), raffles };
  }),

  // Genera enlaces wa.me personalizados por contacto según el segmento.
  // Usable YA, sin API paga: el rifero abre cada enlace y envía manualmente.
  // Variables soportadas en el mensaje: {nombre}, {deuda}, {rifa}.
  buildLinks: protectedProcedure
    .input(
      z.object({
        segment: z.enum(["TAG", "RAFFLE", "DEBT", "NON_BUYERS"]),
        tag: z.string().optional(),
        raffleId: z.string().optional(),
        message: z.string().min(1, "Escribe un mensaje"),
        imageUrl: z.string().url().optional(),
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const { prisma, session } = ctx;
      const userId = ctx.businessId;

      const money = (v: number) =>
        `$${Number(v ?? 0).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

      type Rec = { contactId: string; name: string; phone: string; debt: number; rifa: string };
      let recipients: Rec[] = [];

      if (input.segment === "TAG") {
        const where: any = { userId };
        if (input.tag) where.tags = { has: input.tag };
        const cs = await prisma.contact.findMany({
          where,
          take: input.limit,
          select: { id: true, name: true, phone: true },
        });
        recipients = cs.map((c) => ({ contactId: c.id, name: c.name, phone: c.phone, debt: 0, rifa: "" }));
      } else if (input.segment === "RAFFLE") {
        if (!input.raffleId) throw new TRPCError({ code: "BAD_REQUEST", message: "Elige una rifa" });
        const raffle = await prisma.raffle.findFirst({
          where: { id: input.raffleId, userId },
          select: { title: true },
        });
        const sales = await prisma.sale.findMany({
          where: { userId, raffleId: input.raffleId, status: { notIn: ["CANCELLED", "REFUNDED"] } },
          distinct: ["contactId"],
          take: input.limit,
          select: { contact: { select: { id: true, name: true, phone: true } } },
        });
        recipients = sales.map((s) => ({
          contactId: s.contact.id,
          name: s.contact.name,
          phone: s.contact.phone,
          debt: 0,
          rifa: raffle?.title ?? "",
        }));
      } else if (input.segment === "DEBT") {
        const where: any = { userId, status: { in: ["RESERVED", "PENDING"] } };
        if (input.raffleId) where.raffleId = input.raffleId;
        const sales = await prisma.sale.findMany({
          where,
          select: {
            contactId: true,
            finalAmount: true,
            amountPaid: true,
            contact: { select: { id: true, name: true, phone: true } },
            raffle: { select: { title: true } },
          },
        });
        const map = new Map<string, Rec>();
        for (const s of sales) {
          const debt = Math.max(0, Number(s.finalAmount) - Number(s.amountPaid));
          if (debt <= 0) continue;
          const e =
            map.get(s.contactId) ??
            ({ contactId: s.contactId, name: s.contact.name, phone: s.contact.phone, debt: 0, rifa: s.raffle.title } as Rec);
          e.debt = Math.round((e.debt + debt) * 100) / 100;
          map.set(s.contactId, e);
        }
        recipients = [...map.values()].slice(0, input.limit);
      } else {
        // NON_BUYERS: contactos sin ninguna venta.
        const cs = await prisma.contact.findMany({
          where: { userId, sales: { none: {} } },
          take: input.limit,
          select: { id: true, name: true, phone: true },
        });
        recipients = cs.map((c) => ({ contactId: c.id, name: c.name, phone: c.phone, debt: 0, rifa: "" }));
      }

      const out = recipients.map((r) => {
        const firstName = r.name.trim().split(/\s+/)[0] || r.name;
        const message = input.message
          .replace(/\{nombre\}/gi, firstName)
          .replace(/\{deuda\}/gi, r.debt ? money(r.debt) : "")
          .replace(/\{rifa\}/gi, r.rifa || "");
        // wa.me no adjunta imágenes: si hay imagen, se anexa la URL (WhatsApp
        // muestra la vista previa) para que el comprador la vea.
        const text = input.imageUrl ? `${message}\n\n${input.imageUrl}` : message;
        const digits = r.phone.replace(/\D/g, "");
        const waLink = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
        return { contactId: r.contactId, name: r.name, phone: r.phone, debt: r.debt, message, waLink };
      });

      return { count: out.length, recipients: out };
    }),

  // Cuántos contactos recibirían la campaña según el segmento elegido.
  previewAudience: protectedProcedure
    .input(
      z.object({
        targetAll: z.boolean().default(false),
        targetTags: z.array(z.string()).default([]),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { userId: ctx.businessId };
      if (!input.targetAll && input.targetTags.length > 0) {
        where.tags = { hasSome: input.targetTags };
      }
      const count = await ctx.prisma.contact.count({ where });
      return { count };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2, "Nombre muy corto"),
        type: z
          .enum(["WHATSAPP", "SMS", "EMAIL", "SOCIAL_POST", "REMARKETING", "REFERRAL"])
          .default("WHATSAPP"),
        message: z.string().min(1, "El mensaje no puede estar vacío"),
        targetAll: z.boolean().default(false),
        targetTags: z.array(z.string()).default([]),
        raffleId: z.string().optional(),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      // Estimar destinatarios al momento de crear (multi-tenant: businessId).
      const where: any = { userId: ctx.businessId };
      if (!input.targetAll && input.targetTags.length > 0) {
        where.tags = { hasSome: input.targetTags };
      }
      const totalRecipients = await prisma.contact.count({ where });

      const campaign = await prisma.campaign.create({
        data: {
          userId: ctx.businessId,
          name: input.name,
          type: input.type,
          message: input.message,
          targetAll: input.targetAll,
          targetTags: input.targetTags,
          raffleId: input.raffleId,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
          totalRecipients,
        },
      });

      return campaign;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.prisma.campaign.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.prisma.campaign.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
