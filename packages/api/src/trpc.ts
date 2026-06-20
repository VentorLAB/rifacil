import { initTRPC, TRPCError } from "@trpc/server";
import { type CreateNextContextOptions } from "@trpc/server/adapters/next";
import superjson from "superjson";
import { ZodError } from "zod";
import { getSessionFromRequest } from "@riffas/auth";
import { prisma } from "@riffas/db";
import { getVendorIdFromReq } from "./lib/vendorAuth";

export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  // App Router: leer la sesión desde el request (JWT), sin depender de `res`.
  const session = await getSessionFromRequest(opts.req);

  return {
    prisma,
    session,
    req: opts.req,
    res: opts.res,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const enforceUserIsAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Resuelve el "negocio" del usuario: un co-admin (Eduard) opera sobre los datos
  // de la cuenta raíz (Orlando). businessId = businessOwnerId ?? id. Los routers
  // COMPARTIDOS (rifas, ventas, vendedores, ajustes, reportes) filtran por businessId;
  // los PERSONALES (contactos, campañas) siguen filtrando por userId.
  const u = await ctx.prisma.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { id: true, role: true, businessOwnerId: true },
  });
  if (!u) throw new TRPCError({ code: "UNAUTHORIZED" });

  return next({
    ctx: {
      ...ctx,
      session: { ...ctx.session, user: ctx.session.user },
      userId: u.id,
      businessId: u.businessOwnerId ?? u.id,
      userRole: u.role,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

// Middleware para verificar límites de suscripción (la suscripción es del NEGOCIO).
const enforceSubscriptionLimits = t.middleware(async ({ ctx, next }) => {
  const sub = await ctx.prisma.subscription.findUnique({
    where: { userId: (ctx as any).businessId },
  });

  if (!sub || sub.status === "EXPIRED") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Suscripción requerida" });
  }

  return next({ ctx: { ...ctx, subscription: sub } });
});

export const premiumProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(enforceSubscriptionLimits);

// Procedimiento autenticado por VENDEDOR (cookie httpOnly, independiente de NextAuth).
// Expone ctx.vendor (verificado y activo) y ctx.businessId (= dueño del vendedor),
// para que el vendedor opere SOLO dentro del negocio de su rifero.
const enforceVendor = t.middleware(async ({ ctx, next }) => {
  const vendorId = getVendorIdFromReq(ctx.req);
  if (!vendorId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const vendor = await ctx.prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, userId: true, active: true, role: true, commissionRate: true },
  });
  if (!vendor || !vendor.active) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, vendor, businessId: vendor.userId } });
});

export const vendorProcedure = t.procedure.use(enforceVendor);
