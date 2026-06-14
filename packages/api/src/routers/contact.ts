import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { normalizePhone, parseGoogleContacts, countryFromE164 } from "@riffas/shared";

// Email tolerante para contactos phone-first: vacío, ausente o malformado -> null.
// NUNCA rechaza la fila — los contactos requieren solo teléfono; muchos no traen
// email o lo traen mal escrito. Así un email inválido no tumba el batch entero.
const lenientEmail = z.preprocess(
  (val) => {
    if (typeof val !== "string") return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().email().nullable().catch(null)
);

export const contactRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tags: z.array(z.string()).optional(),
        minSpent: z.number().optional(),
        maxSpent: z.number().optional(),
        hasPurchased: z.boolean().optional(),
        lastPurchaseDays: z.number().optional(),
        source: z.string().optional(),
        city: z.string().optional(),
        sortBy: z.enum(["name", "totalSpent", "lastPurchase", "createdAt"]).default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { prisma, session } = ctx;
      const {
        search,
        tags,
        minSpent,
        maxSpent,
        hasPurchased,
        lastPurchaseDays,
        source,
        city,
        sortBy = "createdAt",
        sortOrder = "desc",
        limit = 20,
        cursor,
      } = input || {};

      const where: any = { userId: session.user.id };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { email: { contains: search, mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } },
        ];
      }

      if (tags && tags.length > 0) where.tags = { hasSome: tags };
      if (minSpent !== undefined) where.totalSpent = { ...where.totalSpent, gte: minSpent };
      if (maxSpent !== undefined) where.totalSpent = { ...where.totalSpent, lte: maxSpent };
      if (hasPurchased !== undefined) {
        if (hasPurchased) where.totalSpent = { gt: 0 };
        else where.totalSpent = { equals: 0 };
      }
      if (lastPurchaseDays !== undefined) {
        if (lastPurchaseDays > 0) {
          where.lastPurchase = { gte: new Date(Date.now() - lastPurchaseDays * 86400000) };
        } else {
          where.lastPurchase = { lte: new Date(Date.now() - Math.abs(lastPurchaseDays) * 86400000) };
        }
      }
      if (source) where.source = source;
      if (city) where.city = { contains: city, mode: "insensitive" };

      const orderBy: any = {};
      orderBy[sortBy] = sortOrder;

      const contacts = await prisma.contact.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy,
        include: {
          _count: { select: { sales: true, numbers: true } },
        },
      });

      let nextCursor: typeof cursor | undefined = undefined;
      if (contacts.length > limit) {
        const nextItem = contacts.pop();
        nextCursor = nextItem!.id;
      }

      return { contacts, nextCursor };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.prisma.contact.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          sales: {
            orderBy: { createdAt: "desc" },
            include: { raffle: { select: { id: true, title: true, prize: true } } },
          },
          numbers: {
            include: { raffle: { select: { id: true, title: true } } },
          },
        },
      });

      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      return contact;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(8),
        email: lenientEmail,
        city: z.string().optional(),
        country: z.string().default("VE"),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        birthday: z.string().datetime().optional(),
        source: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      const phone = normalizePhone(input.phone, "VE");
      if (!phone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Número de teléfono inválido",
        });
      }
      const country = countryFromE164(phone);

      const existing = await prisma.contact.findFirst({
        where: { userId: session.user.id, phone },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un contacto con este número de teléfono",
        });
      }

      const contact = await prisma.contact.create({
        data: {
          ...input,
          phone,
          country,
          userId: session.user.id,
          birthday: input.birthday ? new Date(input.birthday) : undefined,
        },
      });

      return contact;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(1).optional(),
          phone: z.string().min(8).optional(),
          email: z.string().email().optional().nullable(),
          city: z.string().optional().nullable(),
          country: z.string().optional(),
          tags: z.array(z.string()).optional(),
          notes: z.string().optional().nullable(),
          birthday: z.string().datetime().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const data: any = {
        ...input.data,
        birthday: input.data.birthday ? new Date(input.data.birthday) : input.data.birthday,
      };

      if (input.data.phone) {
        const phone = normalizePhone(input.data.phone, "VE");
        if (!phone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Número de teléfono inválido",
          });
        }
        data.phone = phone;
        data.country = countryFromE164(phone);
      }

      const contact = await ctx.prisma.contact.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data,
      });
      return contact;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.contact.delete({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      return { success: true };
    }),

  importCSV: protectedProcedure
    .input(
      z.object({
        data: z.array(
          z.object({
            name: z.string().min(1),
            phone: z.string().min(8),
            email: lenientEmail,
            city: z.string().optional().nullable(),
            tags: z.array(z.string()).optional(),
            notes: z.string().optional().nullable(),
          })
        ),
        format: z.enum(["google_contacts", "excel_simple", "whatsapp_export", "custom"]).default("custom"),
        skipDuplicates: z.boolean().default(true),
        updateExisting: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;
      const { data, updateExisting } = input;
      const userId = session.user.id;
      const now = new Date();

      const results = {
        total: data.length,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string }>,
      };

      // 1) Normalizar y deduplicar el lote entrante por teléfono (E.164).
      //    Importar miles de filas con un find+write por fila satura la función
      //    serverless (timeout). En su lugar: 1 lectura de existentes + createMany.
      const byPhone = new Map<
        string,
        { name: string; phone: string; country: string; email?: string | null; city?: string | null; tags: string[]; notes?: string | null }
      >();
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const phone = normalizePhone(row.phone, "VE");
        if (!phone) {
          results.errors.push({ row: i + 1, error: "Teléfono inválido" });
          continue;
        }
        // El último gana (consolida duplicados dentro del archivo).
        byPhone.set(phone, {
          name: row.name,
          phone,
          country: countryFromE164(phone),
          email: row.email ?? null,
          city: row.city ?? null,
          tags: row.tags ?? [],
          notes: row.notes ?? null,
        });
      }

      // 2) Una sola query para saber qué teléfonos ya existen.
      const existing = await prisma.contact.findMany({
        where: { userId },
        select: { id: true, phone: true, tags: true },
      });
      const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

      const toCreate: any[] = [];
      const toUpdate: Array<{ id: string; row: ReturnType<typeof byPhone.get>; prevTags: string[] }> = [];

      for (const [phone, row] of byPhone) {
        const hit = existingByPhone.get(phone);
        if (hit) {
          if (updateExisting) toUpdate.push({ id: hit.id, row, prevTags: hit.tags });
          else results.skipped++;
        } else {
          toCreate.push({
            name: row!.name,
            phone: row!.phone,
            country: row!.country,
            email: row!.email,
            city: row!.city,
            tags: row!.tags,
            notes: row!.notes,
            userId,
            source: input.format,
            importedFrom: input.format,
            importedAt: now,
          });
        }
      }

      // 3) Insertar nuevos por lotes (createMany), tolerante a carreras.
      const BATCH = 1000;
      for (let i = 0; i < toCreate.length; i += BATCH) {
        const chunk = toCreate.slice(i, i + BATCH);
        const res = await prisma.contact.createMany({ data: chunk, skipDuplicates: true });
        results.imported += res.count;
      }

      // 4) Actualizar existentes (solo los que se solapan) con concurrencia acotada.
      const UPDATE_CONCURRENCY = 25;
      for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
        const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
        await Promise.all(
          chunk.map(async ({ id, row, prevTags }) => {
            try {
              await prisma.contact.update({
                where: { id },
                data: {
                  name: row!.name || undefined,
                  email: row!.email || undefined,
                  city: row!.city || undefined,
                  tags: row!.tags.length ? [...new Set([...prevTags, ...row!.tags])] : undefined,
                  importedFrom: input.format,
                  importedAt: now,
                },
              });
              results.updated++;
            } catch (e: any) {
              results.errors.push({ row: 0, error: e.message });
            }
          })
        );
      }

      // updateMany no lanza si el usuario aún no tiene suscripción.
      await prisma.subscription.updateMany({
        where: { userId },
        data: { contactsUsed: { increment: results.imported } },
      });

      return results;
    }),

  getStats: protectedProcedure.query(async ({ ctx }) => {
    const { prisma, session } = ctx;

    const [total, withPurchases, newThisMonth, topSpenders] = await Promise.all([
      prisma.contact.count({ where: { userId: session.user.id } }),
      prisma.contact.count({ where: { userId: session.user.id, totalSpent: { gt: 0 } } }),
      prisma.contact.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.contact.findMany({
        where: { userId: session.user.id },
        orderBy: { totalSpent: "desc" },
        take: 5,
        select: { id: true, name: true, phone: true, totalSpent: true, totalTickets: true },
      }),
    ]);

    return { total, withPurchases, newThisMonth, topSpenders };
  }),
});
