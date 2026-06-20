-- Equipo/negocio: un usuario puede ser miembro (co-admin) del negocio de otro.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessOwnerId" TEXT;
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_businessOwnerId_fkey"
    FOREIGN KEY ("businessOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "User_businessOwnerId_idx" ON "User"("businessOwnerId");
