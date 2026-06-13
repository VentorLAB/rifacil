# Deploy a Vercel — Rifácil (monorepo Turborepo + pnpm)

Guía de despliegue de `apps/web` (Next.js 14) a Vercel, cubriendo las trampas del
monorepo y del recibo server-side.

## 1. Configuración del proyecto en Vercel

Crear el proyecto desde el repo de GitHub y, en **Settings → General**:

- **Root Directory:** `apps/web`
  (marca "Include source files outside of the Root Directory" — Vercel instala
  desde la raíz del workspace y resuelve los paquetes `@riffas/*`).
- **Framework Preset:** Next.js (autodetectado).
- **Install Command:** dejar el default (`pnpm install`). Detecta `pnpm` por el
  `packageManager` del `package.json` raíz y el `pnpm-workspace.yaml`.
- **Build Command:** default (`next build`).
- **Node.js Version:** 20.x.

> Alternativa sin tocar el dashboard: un `vercel.json` en la raíz con
> `{"buildCommand":"pnpm turbo run build --filter=@riffas/web","outputDirectory":"apps/web/.next","framework":"nextjs"}`.
> Se recomienda **Root Directory = apps/web** porque la detección de funciones
> serverless de Next es más confiable así.

## 2. El cliente Prisma se genera en el build (no se versiona)

`packages/db/src/generated/` está en `.gitignore` (incluye el engine nativo `.node`).
Se regenera solo: **`packages/db` tiene un `postinstall: "prisma generate"`** que
corre durante el `pnpm install` de Vercel. `prisma generate` NO requiere conexión a
la DB ni las env vars, así que nunca bloquea el install.

## 3. Variables de entorno (Settings → Environment Variables)

Definir en **Production** (y Preview si aplica):

| Variable | Notas |
|---|---|
| `DATABASE_URL` | Neon **pooled** (`-pooler`), con `sslmode=require`. Lo usa el runtime. |
| `DIRECT_URL` | Neon **directo** (sin pooler). Lo usa Prisma para migraciones. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | URL de producción, ej. `https://rifacil.vercel.app`. |
| `CLOUDINARY_CLOUD_NAME` | Para subir los recibos. |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Opcional (login con Google). |

⚠️ **NO** definir `CLOUDINARY_URL`: en el `.env` local trae `<placeholders>` y el SDK
lo auto-parsea mal. El recibo usa las 3 variables discretas.

## 4. Migraciones de base de datos

El build **no** corre migraciones. Cuando agregues una migración nueva, aplicala a
la DB de producción aparte:

```bash
DATABASE_URL=... DIRECT_URL=... pnpm --filter @riffas/db exec prisma migrate deploy
```

(La Neon actual ya está migrada — no hace falta nada para el primer deploy.)

## 5. Recibo server-side en producción (lo crítico)

El recibo se genera dentro del `saleRouter` (ruta `/api/trpc`), que usa
`satori → @resvg/resvg-js (binario nativo) → Cloudinary`. Para que NO crashee en
serverless (aunque ande local) ya está configurado:

- **Fuente Inter 600 embebida en base64** (`packages/shared/src/inter-font.ts`).
  No se lee del filesystem: al bundlearse el paquete, `import.meta.url`/`__dirname`
  no apuntan al `.woff` en disco. Embebida = cero filesystem, cero red.
  Regenerar (si cambia la fuente) desde `packages/shared/assets/Inter-SemiBold.woff`.
- **`@resvg/resvg-js` externo** (`experimental.serverComponentsExternalPackages` +
  webpack external) → se requiere desde `node_modules` en runtime.
- **`outputFileTracingRoot` = raíz del monorepo** → `node-file-trace` incluye el
  binario nativo de resvg (vive en `node_modules/.pnpm/...`) en la función.
- **`/api/trpc/[trpc]`** fija `runtime = "nodejs"` y `maxDuration = 30`.

> En Vercel (Linux) pnpm instala el binario correcto (`@resvg/resvg-js-linux-x64-gnu`)
> vía optionalDependencies. Si el recibo fallara con "module not found" del binario,
> verificar que el lockfile traiga esa optional dep.

## 6. Deuda técnica conocida (NO bloquea el deploy, arreglar luego)

- `next.config.js` tiene `typescript.ignoreBuildErrors` y `eslint.ignoreDuringBuilds`
  en `true` para no bloquear el MVP con errores pre-existentes. **Revertir a `false`
  tras limpiar tipos.**
- `packages/api/src/routers/raffle.ts` importa `generateNumbers` de `@riffas/shared`
  pero **no está exportado** → la **creación de rifas romperá en runtime**. Implementar/
  exportar `generateNumbers` antes de usar ese flujo en producción.
- Otros errores de tipos pre-existentes: `settings.ts` (`acceptedPaymentMethods`),
  páginas de `app/` con `any` implícitos. No afectan pagos/recibos.
