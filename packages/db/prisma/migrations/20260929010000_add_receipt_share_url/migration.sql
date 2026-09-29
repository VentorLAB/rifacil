-- Add Sale.receiptShareUrl (ImgBB/ibb.co link → large WhatsApp preview card).
-- IF NOT EXISTS porque en prod (Neon) se aplicó manualmente vía endpoint pooled:
-- el endpoint DIRECT_URL no era alcanzable al momento de la migración.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "receiptShareUrl" TEXT;
