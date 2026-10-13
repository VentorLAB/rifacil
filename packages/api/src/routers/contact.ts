import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { normalizePhone, parseGoogleContacts, countryFromE164, sortBySpent } from "@riffas/shared";
import type { PrismaClient } from "@riffas/db";

/**
 * USD actually collected per contact: CONFIRMED payments of sales that were not
 * cancelled or refunded. Only contacts of `userId` (tenant rule #6); optionally
 * limited to `contactIds`.
 */
async function spentByContact(
  prisma: PrismaClient,
  userId: string,
  contactIds?: string[],
): Promise<Map<string, number>> {
  if (contactIds && contactIds.length === 0) return new Map();
  const rows = contactIds
    ? await prisma.$queryRaw<{ contactId: string; spent: unknown }[]>`
        SELECT s."contactId", SUM(p.amount) AS spent
        FROM "Payment" p
        JOIN "Sale" s ON s.id = p."saleId"
        JOIN "Contact" c ON c.id = s."contactId"
        WHERE c."userId" = ${userId}
          AND c.id = ANY(${contactIds}::text[])
          AND p.status = 'CONFIRMED'
          AND s.status NOT IN ('CANCELLED', 'REFUNDED')
        GROUP BY s."contactId"`
    : await prisma.$queryRaw<{ contactId: string; spent: unknown }[]>`
        SELECT s."contactId", SUM(p.amount) AS spent
        FROM "Payment" p
        JOIN "Sale" s ON s.id = p."saleId"
        JOIN "Contact" c ON c.id = s."contactId"
        WHERE c."userId" = ${userId}
          AND p.status = 'CONFIRMED'
          AND s.status NOT IN ('CANCELLED', 'REFUNDED')
        GROUP BY s."contactId"`;
  return new Map(rows.map((r) => [r.contactId, Math.round(Number(r.spent) * 100) / 100]));
}

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
        // totalSpent = USD of CONFIRMED payments (computed, see spentByContact);
        // purchases = number of sales.
        sortBy: z.enum(["name", "totalSpent", "purchases", "lastPurchase", "createdAt"]).default("createdAt"),
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

      const include = { _count: { select: { sales: true, numbers: true } } } as const;

      // "Total gastado" is not a column (the cached Contact.totalSpent is not kept
      // in sync with every abono), so it cannot be a Prisma orderBy. Sort the
      // whole filtered set by the real figure and page by position ("o:<offset>").
      if (sortBy === "totalSpent") {
        const all = await prisma.contact.findMany({ where, select: { id: true, name: true }, take: 20_000 });
        const spent = await spentByContact(prisma, session.user.id);
        const ordered = sortBySpent(all.map((c) => ({ ...c, spentUsd: spent.get(c.id) ?? 0 })), sortOrder);
        const offset = cursor?.startsWith("o:") ? Number(cursor.slice(2)) || 0 : 0;
        const pageIds = ordered.slice(offset, offset + limit).map((c) => c.id);
        const rows = await prisma.contact.findMany({ where: { id: { in: pageIds } }, include });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const contacts = pageIds
          .map((id) => byId.get(id))
          .filter((c): c is (typeof rows)[number] => !!c)
          .map((c) => ({ ...c, spentUsd: spent.get(c.id) ?? 0 }));
        const nextCursor = offset + limit < ordered.length ? `o:${offset + limit}` : undefined;
        return { contacts, nextCursor };
      }

      // Columns Prisma can order by; id as tie-breaker keeps cursor pages stable.
      const primary: any =
        sortBy === "purchases" ? { sales: { _count: sortOrder } } : { [sortBy]: sortOrder };

      const contacts = await prisma.contact.findMany({
        where,
        take: limit + 1,
        cursor: cursor && !cursor.startsWith("o:") ? { id: cursor } : undefined,
        orderBy: [primary, { id: "asc" }],
        include,
      });

      let nextCursor: typeof cursor | undefined = undefined;
      if (contacts.length > limit) {
        const nextItem = contacts.pop();
        nextCursor = nextItem!.id;
      }

      const spent = await spentByContact(prisma, session.user.id, contacts.map((c) => c.id));
      return { contacts: contacts.map((c) => ({ ...c, spentUsd: spent.get(c.id) ?? 0 })), nextCursor };
    }),

  // Devuelve SOLO los IDs (y total) de los contactos que matchean los filtros.
  // Pensado para el "select all matching filter" del UI bulk delete: la página
  // muestra 50 paginados pero el usuario puede querer seleccionar los 470 que
  // matchean un filtro (ej. tag=v1_import). Capeado a 5000 como red de seguridad.
  listIds: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        city: z.string().optional(),
        hasPurchased: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, tags, source, city, hasPurchased } = input || {};
      const where: any = { userId: ctx.session.user.id };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { email: { contains: search, mode: "insensitive" } },
        ];
      }
      if (tags && tags.length > 0) where.tags = { hasSome: tags };
      if (source) where.source = source;
      if (city) where.city = { contains: city, mode: "insensitive" };
      if (hasPurchased === true) where.totalSpent = { gt: 0 };
      if (hasPurchased === false) where.totalSpent = { equals: 0 };

      const contacts = await ctx.prisma.contact.findMany({
        where,
        select: { id: true },
        take: 5000,
      });
      return { ids: contacts.map((c) => c.id), total: contacts.length };
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

  // Borrado individual con GUARD de ventas. Importante: el schema tiene
  // Sale.contact con onDelete: Cascade — sin este guard, borrar un Contact
  // destruye sus ventas en cascada. TODO(cleanup): cambiar onDelete a Restrict
  // en una migration futura para que la DB misma rechace el borrado.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.prisma.contact.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: { _count: { select: { sales: true, numbers: true } } },
      });
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      if (contact._count.sales > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede borrar: tiene ${contact._count.sales} venta(s) asociada(s). Cancela las ventas primero.`,
        });
      }
      // RaffleNumber.contactId solo se setea con una Sale (ver public.createSale,
      // sale.create) — si sales=0, no hay numbers asignados. Doble check defensivo:
      if (contact._count.numbers > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede borrar: tiene ${contact._count.numbers} número(s) asignado(s).`,
        });
      }
      await ctx.prisma.contact.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // Borrado en lote. Estrategia partial-report: borra los que se pueden y
  // reporta los bloqueados (con razón y conteos). Multi-tenant: solo borra
  // contactos del session user. Por contacto: o se borra completo o se reporta,
  // nunca borrado a medias.
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const { prisma, session } = ctx;

      // 1) Traer todos los contactos que coinciden con los IDs Y pertenecen
      //    al user. Esto cubre el guard multi-tenant: IDs ajenos quedan fuera.
      const owned = await prisma.contact.findMany({
        where: { id: { in: input.ids }, userId: session.user.id },
        select: {
          id: true,
          name: true,
          _count: { select: { sales: true, numbers: true } },
        },
      });

      const ownedIds = new Set(owned.map((c) => c.id));
      const notOwned = input.ids.filter((id) => !ownedIds.has(id));

      // 2) Clasificar: borrables vs bloqueados por ventas/números
      const deletable: string[] = [];
      const blocked: Array<{ id: string; name: string; salesCount: number; numbersCount: number }> = [];
      for (const c of owned) {
        if (c._count.sales > 0 || c._count.numbers > 0) {
          blocked.push({
            id: c.id,
            name: c.name,
            salesCount: c._count.sales,
            numbersCount: c._count.numbers,
          });
        } else {
          deletable.push(c.id);
        }
      }

      // 3) Borrar los borrables en una sola operación (atómica a nivel DB).
      let deletedCount = 0;
      if (deletable.length > 0) {
        const result = await prisma.contact.deleteMany({
          where: { id: { in: deletable }, userId: session.user.id },
        });
        deletedCount = result.count;
      }

      return {
        requested: input.ids.length,
        deleted: deletedCount,
        blocked,
        notOwnedCount: notOwned.length,
      };
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
