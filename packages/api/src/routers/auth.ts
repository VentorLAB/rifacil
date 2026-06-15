import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { normalizePhone } from "@riffas/shared";
import bcrypt from "bcryptjs";

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2, "Nombre muy corto"),
        telefono: z.string().min(7, "Teléfono inválido"),
        password: z.string().min(8, "Mínimo 8 caracteres"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // El rifero escribe "0424…"; lo guardamos en E.164 ("+58424…").
      const phone = normalizePhone(input.telefono, "VE");
      if (!phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Teléfono inválido" });
      }

      const existing = await ctx.prisma.user.findUnique({
        where: { phone },
      });

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Teléfono ya registrado" });
      }

      const hashedPassword = await bcrypt.hash(input.password, 12);

      const user = await ctx.prisma.user.create({
        data: {
          name: input.name,
          phone,
          passwordHash: hashedPassword,
        },
      });

      // Crear suscripción trial
      await ctx.prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "STARTER",
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          maxRaffles: 3,
          maxContacts: 500,
          maxVendors: 2,
          maxNumbers: 1000,
          maxCampaignsPerMonth: 3,
        },
      });

      // Crear settings default
      await ctx.prisma.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      return { success: true, userId: user.id };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      include: {
        settings: true,
        subscriptions: true,
      },
    });

    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        avatar: z.string().url().optional(),
        brandName: z.string().optional().nullable(),
        brandLogo: z.string().url().optional().nullable(),
        brandColor: z.string().regex(/^#([0-9a-fA-F]{6})$/, "Color inválido").optional().nullable(),
        brandColorSecondary: z.string().regex(/^#([0-9a-fA-F]{6})$/, "Color inválido").optional().nullable(),
        brandSlug: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: input,
      });
      return user;
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
      });

      if (!user?.passwordHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Usuario sin contraseña" });
      }

      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Contraseña actual incorrecta" });
      }

      const hashed = await bcrypt.hash(input.newPassword, 12);
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashed },
      });

      return { success: true };
    }),
});
