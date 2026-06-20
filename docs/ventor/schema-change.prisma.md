# Cambio en `packages/db/prisma/schema.prisma` — modelo `User`

Añade el campo `customDomain` junto a `brandSlug` (dentro del bloque `// Branding personal`):

```prisma
  // Branding personal
  brandName          String?
  brandLogo          String?
  brandColor         String?   @default("#3b82f6")
  brandColorSecondary String?  @default("#1e293b")
  brandSlug          String?   @unique // riffas.app/mi-marca
  customDomain       String?   @unique // dominio propio del rifero, ej. rifashermanospernia.com
```

> Guárdalo SIEMPRE en minúsculas y sin `www.` al asignarlo (ej. `"rifashermanospernia.com"`),
> porque el middleware y el router normalizan así para resolver el tenant.

Luego genera/aplica la migración:

```bash
pnpm --filter @riffas/db prisma migrate dev --name add_custom_domain    # local
# o en producción:
pnpm --filter @riffas/db prisma migrate deploy
```
