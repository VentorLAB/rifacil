-- Añade dominio propio por rifero. Equivale a la migración Prisma
-- `add_custom_domain`. Úsala si aplicas SQL directo en vez de prisma migrate.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customDomain" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_customDomain_key" ON "User"("customDomain");
