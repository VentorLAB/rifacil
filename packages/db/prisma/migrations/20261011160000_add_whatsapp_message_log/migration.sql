-- Metering de mensajes WhatsApp por tenant (envío/entrega/lectura/fallo + costo
-- estimado Meta). Aditiva: no toca tablas existentes. IF NOT EXISTS por si se
-- aplica manual vía endpoint pooled de Neon como la anterior.
CREATE TABLE IF NOT EXISTS "WhatsappMessageLog" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT,
  "recipient" TEXT NOT NULL,
  "templateName" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'UTILITY',
  "provider" TEXT NOT NULL,
  "messageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "countryCode" TEXT,
  "costUsd" DOUBLE PRECISION,
  "pricingNote" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsappMessageLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappMessageLog_messageId_key" ON "WhatsappMessageLog"("messageId");
CREATE INDEX IF NOT EXISTS "WhatsappMessageLog_businessId_createdAt_idx" ON "WhatsappMessageLog"("businessId", "createdAt");
