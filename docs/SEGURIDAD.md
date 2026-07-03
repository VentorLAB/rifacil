# Seguridad Rifácil — Hallazgos y plan de endurecimiento

> Auditoría 2026-06-27. Estado base: **sin vulnerabilidades CRÍTICAS**, sin secretos
> commiteados, `.env` ignorado, contraseñas con bcrypt(12), aislamiento multi-tenant
> correcto (cada query filtra por `businessId`/`userId`). Lo que sigue es el backlog
> priorizado para hacer **después del demo**.

## Prioridad 1 — Rate limiting (HIGH, el #1)
Hoy **no hay rate limiting en ningún lado**. Upstash Redis YA está provisionado en
`.env` (`UPSTASH_REDIS_REST_URL/TOKEN`) pero no se usa (0 referencias en el código).

Superficie pública sin límite:
- `public.createSale` (`packages/api/src/routers/public.ts:427`) — anónimo; crea Contact+Sale+Payment, marca números SOLD y renderiza+sube recibo a Cloudinary. Spameable → bloat de DB, costo Cloudinary, y permite **acaparar todos los números** de una rifa (DoS de la rifa).
- `public.uploadProof` (`public.ts:408`) — subida anónima a Cloudinary, sin tope de tamaño real.
- `auth.register` + login NextAuth (`packages/auth/src/index.ts:30`) — brute force de credenciales.
- `POST /api/vendor/login` (`apps/web/app/api/vendor/login/route.ts:24`) — adivinanza ilimitada de un accessCode de 6 chars.
- `public.verify` (`public.ts:330`) y `public.getRaffle` (incrementa viewCount).

**Acción:** `@upstash/ratelimit` por IP+procedimiento en todas las mutaciones
`publicProcedure` y ambos logins (con backoff/lockout). Topar tamaño de
`uploadProof`/`uploadImage` (rechazar data URIs > ~5 MB) antes de Cloudinary.
Esto cierra de un golpe el abuso, el DoS de rifa y el **scraping** (que también es el
vector de robo de datos por un competidor).

## Prioridad 2 — Token de vendedor (HIGH)
`packages/api/src/lib/vendorAuth.ts:7`
```ts
const SECRET = process.env.NEXTAUTH_SECRET || "dev-secret-change-me";
```
- Si `NEXTAUTH_SECRET` faltara en algún entorno, los tokens se firman con un secreto
  **público hardcodeado** → cualquiera puede forjar `rf_vendor` e impersonar a
  cualquier vendedor (registrar ventas, cobrar).
- El token es `vendorId.HMAC(vendorId)` **sin expiración**; cookie de 30 días. Cookie
  robada = acceso de vendedor por mucho tiempo.

**Acción:** quitar el fallback (`throw` si falta el secreto; usar un
`VENDOR_TOKEN_SECRET` dedicado). Embeber issued-at/exp en el payload y validarlo.

## Prioridad 3 — Integridad del sorteo (MEDIUM, confianza del producto)
`packages/api/src/routers/raffle.ts` (`provableRandom`, ~:761) — el seed por defecto
se arma con valores que el rifero conoce (id de rifa, conteo vendido, businessId) →
**ganador predecible**; además el rifero puede pasar `input.seed` arbitrario y
**elegir el ganador**. `% max` tiene sesgo de módulo.

**Acción:** `crypto.randomInt(max)` (sin sesgo) o esquema commit-reveal con seed
público **publicado antes** de cerrar ventas. No dejar que el operador provea el seed
después. Para una app de rifas, la integridad del sorteo es el core de la confianza.

## Prioridad 4 — PII y secretos por-tenant (MEDIUM)
- **Token de WhatsApp BSP en texto plano** (`settings.update`, `routers/settings.ts:55`;
  se manda como `Bearer` en `lib/whatsapp.ts:55`). Un volcado de DB filtra el token
  Meta de cada tenant. → Cifrar en reposo; nunca devolverlo al cliente en `settings.get`.
- **Cédula (idDocument) y datos bancarios** expuestos en endpoints 100% públicos
  (`public.getStorefrontByDomain` y `public.getRaffle`). Necesario parte para pagar,
  pero la cédula es PII scrapeable. → Mostrar solo lo imprescindible; idealmente
  detrás del paso de checkout + rate limit.
- **Enumeración de clientes** vía `public.verify` (phone → revela si es cliente, nombre
  enmascarado, números, montos). → Rate limit + pedir nº de recibo, no solo teléfono.

## Prioridad 5 — Defensa en profundidad (LOW)
- **Sin guard server-side en el panel:** `app/(dashboard)/dashboard/layout.tsx` es
  `"use client"` sin `getServerSession`/redirect. Los datos están a salvo (todo pasa
  por `protectedProcedure`), pero conviene un check server-side por UX/defensa.
- **Provider de Google** siempre registrado con creds vacías → gatearlo por env.
- **CSRF** depende de `SameSite=Lax` (default). No aflojar las cookies.

## Anti-clonado / propiedad intelectual — la verdad práctica
- El código vive en el **servidor** (tRPC, Prisma, lógica de recibos/precios). El
  navegador solo recibe React compilado del storefront/panel. **Tu lógica no se
  descarga.** Ofuscar/minificar **no** es protección real.
- **Acción barata y prioritaria:** repo en **privado** + publicar **Términos de
  Servicio + Privacidad** que prohíban scraping y reverse engineering (palanca legal
  de takedown; hoy no hay ToS).
- **Tu foso real no es el código, son:**
  1. **Los datos del rifero** (contactos importados, historial de ventas, deudores,
     cuentas de pago) — costo de cambio alto. Hacé el import fácil y el workflow
     recurrente (recibos/campañas) pegajoso.
  2. **Distribución y marca** (rifacil.vip, dominios propios, recibos verificables).
  3. **Anti-scraping** (P1) — protege seguridad *y* el foso de datos a la vez.
- **Watermark del recibo:** ya generás el recibo server-side; un sello sutil de
  marca/tenant lo hace identificable en la calle, a costo cero.

**Orden sugerido post-demo:** P1 (rate limiting) → P2 (token vendedor) → P4 (cifrar
token WA) → P3 (sorteo) → repo privado + ToS + guard del panel.
