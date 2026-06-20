# Decisión técnica + plan de ejecución — Riffas 2.0 (rifacil)
### Para Orlando Pernía hoy, y resellable a cualquier rifero

> Reemplaza al spec anterior basado en Supabase-RLS. **Ese enfoque ya no aplica**: tu repo
> `rifacil` no es greenfield, es una plataforma madura con su propio modelo. Aquí está la
> decisión correcta sobre lo que YA tienes.

---

## 1. Qué encontré en el repo (de pies a cabeza)

`rifacil` = **Riffas 2.0**, un monorepo Turborepo serio y casi terminado:

- **Stack:** Next.js 14 (App Router) · tRPC · Prisma + PostgreSQL · NextAuth · Tailwind · pnpm · turbo · Cloudinary (recibos server-side con Satori→PNG, ya resuelto para iPhone).
- **Ya es multi-tenant.** Cada rifero es un `User` (rol RIFERO/ADMIN/SUPER_ADMIN). Toda query filtra por `userId`. El aislamiento entre riferos está en la capa tRPC, no en la DB — y eso está **bien hecho**.
- **Ya tiene tienda web pública** en `/r/[id]` (sin login): ver rifa, listar números, **comprar** (`createSale`), subir comprobante, **verificar boleto**. Eso ES tu "rifas-hp".
- **Ya tiene** dashboard del rifero (ventas físicas), portal de vendedores con comisión/recaudo, CRM de contactos con búsqueda fuzzy, campañas WhatsApp, **planes/suscripciones** (FREE/STARTER/PRO/ENTERPRISE) con límites aplicados en middleware tRPC, tasa USD/VES (BCV/Binance), métodos de pago venezolanos primero.
- **Ya tiene branding por rifero:** logo, colores, y `brandSlug` (`riffas.app/mi-marca`).

**Conclusión:** el 85–90% de tu visión ya está construido en este repo.

---

## 2. La decisión (lo mejor y más rápido)

**Decisión 1 — Retiramos `rifas-hp`.** No lo conectamos a la misma base; lo jubilamos. Tener dos
codebases apuntando a una DB es justo el problema frágil que quieres evitar. La tienda web pública
**ya vive dentro del monorepo** (`/r/[id]`), comparte la **misma** base Prisma/Postgres que el
panel y las ventas físicas. "Una sola base de datos" no hay que construirla: ya es así por diseño.
Si quieres, `rifas-hp.vercel.app` queda solo como landing de marketing, nunca como segundo sistema.

**Decisión 2 — Conservamos el stack tal cual.** No reescribimos nada. Next.js + tRPC + Prisma +
Postgres en Vercel (tienes Pro). El aislamiento por `userId` en tRPC es correcto; **no** metemos
RLS de Supabase encima (chocaría con Prisma).

**Decisión 3 — Base de datos = Postgres administrado.** El schema usa `DATABASE_URL` (pooled) +
`DIRECT_URL`. Sirve **Supabase** (como Postgres puro: Prisma manda el schema, NO usamos Auth/RLS de
Supabase) o **Neon**. Recomiendo Supabase para consolidar, pero Neon es igual de válido.

**Decisión 4 — Lo único que falta construir = dominio propio por rifero.** Hoy hay `brandSlug`
(`riffas.app/mi-marca`) pero **no** dominio propio (`rifashermanospernia.com`). No existe
`customDomain` ni `middleware.ts`. **Eso es lo que te escribí** (carpeta `apps/web/...`). Con esto,
cada cliente que vendas recibe su `sudominio.com` mostrando SU tienda, con su control rifacil, todo
sobre la misma base.

---

## 3. El código que te dejé (el 10% que falta)

Cópialo dentro del repo respetando las rutas:

| Archivo entregado | Va en el repo a |
|---|---|
| `migration-add-customDomain.sql` | correr en la DB (o `prisma migrate`) |
| `schema-change.prisma.md` | editar `packages/db/prisma/schema.prisma` (modelo `User`) |
| `apps/web/middleware.ts` | `apps/web/middleware.ts` (nuevo) |
| `public-router-addition.ts` | pegar el procedure en `packages/api/src/routers/public.ts` |
| `apps/web/app/t/d/[host]/page.tsx` | `apps/web/app/t/d/[host]/page.tsx` (nuevo) |

Cómo funciona: el `middleware` mira el host entrante. Si es un dominio de la plataforma
(`rifacil.vip`, `*.vercel.app`, `localhost`) → comportamiento normal. Si es el dominio propio de un
rifero → reescribe la home a `/t/d/<host>`, que resuelve al rifero por `customDomain` y muestra SU
tienda con sus rifas activas (cada una enlaza al `/r/[id]` que ya existe). Los links de rifa siguen
funcionando bajo su dominio sin tocar nada.

---

## 4. Runbook — poner a Orlando en producción

1. **Crear la base.** Proyecto Postgres nuevo (Supabase `ventor-rifas-core` o Neon). Copia
   `DATABASE_URL` (pooled, puerto 6543 en Supabase) y `DIRECT_URL` (directo, 5432).
2. **Variables en Vercel** (proyecto rifacil): `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`,
   `NEXTAUTH_SECRET`, Cloudinary, y los de WhatsApp cuando toque.
3. **Aplicar schema:** añade `customDomain` al modelo `User`, luego
   `pnpm --filter @riffas/db prisma migrate deploy` (o `migrate dev` en local).
4. **Pegar el código de dominio** (tabla de arriba) y desplegar a Vercel.
5. **Crear la cuenta de Orlando** (rifero): nombre "Rifas Hermanos Pernía", su teléfono, branding
   (logo + colores), métodos de pago (Pago Móvil / Binance / Zelle / efectivo).
6. **Setear su dominio:** `customDomain = "rifashermanospernia.com"` en su `User`.
7. **Cargar su primera rifa** desde el dashboard y generar sus números.
8. **Conectar el dominio en Vercel** (tienes Pro): Project → Domains → agrega
   `rifashermanospernia.com` y `www`. En tu registrador apunta los DNS a Vercel (A `76.76.21.21`
   o CNAME a `cname.vercel-dns.com`). Vercel emite el SSL solo.
9. **Probar:** abre `rifashermanospernia.com` → debe cargar la tienda de Orlando; comprar un número
   en web y verlo reflejado en el dashboard (misma base).

---

## 5. Convertirlo en producto vendible a otros riferos

Ya tienes el motor (planes, branding, multi-tenant). Para escalar la venta:

- **Onboarding self-service:** un flujo donde el rifero se registra, configura branding y métodos de
  pago (el repo ya tiene `onboardingStep`). El dominio propio se lo activas tú (o lo automatizas con
  la API de dominios de Vercel) al contratar el plan PRO.
- **Plan que incluye dominio propio:** que `customDomain` solo se permita en PRO/ENTERPRISE
  (validación en el router de settings, igual que ya limitas otras cosas por plan).
- **Tu rol platform_admin** (SUPER_ADMIN) para dar de alta riferos y ver todo.
- **Página de beneficios/precios** estilo rifarito para vender el SaaS (eso sí puede vivir en una
  landing aparte o en la home de `riffas.app`).

---

## 6. Lo crítico a verificar antes de lanzar (no opcional)

- **Anti-doble-venta concurrente:** confirma que `createSale`/reserva use una transacción Prisma con
  guarda `where: { status: 'AVAILABLE' }` en el `updateMany` (gracias al `@@unique([raffleId, number])`,
  dos compras simultáneas del mismo número → solo una gana). Pruébalo con dos pestañas.
- **Recibo en iPhone real** (regla de oro del proyecto).
- **Límites de plan** aplicados en servidor, no solo UI.
- **Reservas sin pago** se liberan al expirar (`reservationExpiryMinutes`, default 30).
