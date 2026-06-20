import { z } from "zod";
import { VendorRole } from "@riffas/db";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { normalizePhone } from "@riffas/shared";
import { generateAccessCode } from "../lib/vendorAuth";

// Genera un código corto y legible a partir del nombre (p. ej. "Juan Pérez" -> "JUAN").
function baseCodeFromName(name: string): string {
  // NFD descompone acentos (á -> a +  ́); el filtro alfanumérico borra las marcas.
  const clean = name
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return (clean.slice(0, 5) || "VEND");
}

export const vendorRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          activeOnly: z.boolean().optional(),
          role: z.enum(["ALL", "VENDEDOR", "ADMIN"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { prisma } = ctx;
      const where: any = { userId: ctx.businessId };
      if (input?.activeOnly) where.active = true;
      if (input?.role && input.role !== "ALL") where.role = input.role;
      if (input?.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { lastName: { contains: input.search, mode: "insensitive" } },
          { idDocument: { contains: input.search, mode: "insensitive" } },
          { code: { contains: input.search, mode: "insensitive" } },
          { phone: { contains: input.search } },
        ];
      }

      const vendors = await prisma.vendor.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      return { vendors };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const vendor = await ctx.prisma.vendor.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        include: {
          _count: { select: { sales: true, numbers: true } },
        },
      });
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND" });
      return vendor;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2, "Nombre muy corto"),
        lastName: z.string().optional().or(z.literal("")),
        idDocument: z.string().optional().or(z.literal("")),
        phone: z.string().min(7, "Teléfono inválido"),
        email: z.string().email().optional().or(z.literal("")),
        role: z.nativeEnum(VendorRole).default(VendorRole.VENDEDOR),
        commissionRate: z.number().min(0).max(100).default(0),
        code: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma } = ctx;

      const phone = normalizePhone(input.phone, "VE");
      if (!phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Teléfono inválido" });
      }

      // Verificar límite de vendedores del plan.
      const sub = await prisma.subscription.findUnique({
        where: { userId: ctx.businessId },
      });
      if (sub) {
        const count = await prisma.vendor.count({ where: { userId: ctx.businessId } });
        if (count >= sub.maxVendors) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Tu plan permite máximo ${sub.maxVendors} vendedores.`,
          });
        }
      }

      // `code` es único a nivel global → generamos uno disponible.
      let code = (input.code || baseCodeFromName(input.name)).toUpperCase();
      const base = baseCodeFromName(input.name);
      // Si el code pedido/derivado ya existe, agregamos sufijo numérico.
      for (let attempt = 0; attempt < 50; attempt++) {
        const exists = await prisma.vendor.findUnique({ where: { code } });
        if (!exists) break;
        code = `${base}${Math.floor(10 + attempt * 7 + attempt)}`;
      }

      const vendor = await prisma.vendor.create({
        data: {
          userId: ctx.businessId,
          name: input.name,
          lastName: input.lastName || null,
          idDocument: input.idDocument || null,
          phone,
          email: input.email || null,
          role: input.role,
          commissionRate: input.commissionRate,
          code,
          accessCode: generateAccessCode(), // PIN para "Mi panel"
        },
      });

      return vendor;
    }),

  // (Re)genera el código de acceso del vendedor (para entrar a "Mi panel").
  regenerateAccess: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.prisma.vendor.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

      const accessCode = generateAccessCode();
      await ctx.prisma.vendor.update({ where: { id: input.id }, data: { accessCode } });
      return { accessCode };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(2).optional(),
          lastName: z.string().optional().nullable(),
          idDocument: z.string().optional().nullable(),
          phone: z.string().min(7).optional(),
          email: z.string().email().optional().nullable().or(z.literal("")),
          role: z.nativeEnum(VendorRole).optional(),
          commissionRate: z.number().min(0).max(100).optional(),
          active: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const data: any = { ...input.data };
      // Normalizar strings opcionales: "" -> null para campos nullable.
      if (data.lastName === "") data.lastName = null;
      if (data.idDocument === "") data.idDocument = null;
      if (data.email === "") data.email = null;
      if (input.data.phone) {
        const phone = normalizePhone(input.data.phone, "VE");
        if (!phone) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Teléfono inválido" });
        }
        data.phone = phone;
      }
      // Asegurar pertenencia (multi-tenant) antes de actualizar.
      const owned = await ctx.prisma.vendor.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

      const vendor = await ctx.prisma.vendor.update({
        where: { id: input.id },
        data,
      });
      return vendor;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.prisma.vendor.findFirst({
        where: { id: input.id, userId: ctx.businessId },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.prisma.vendor.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
