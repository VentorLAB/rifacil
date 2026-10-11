-- Chatbot WhatsApp: conversaciones con memoria + config por rifero (ADITIVA)
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "chatbotEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "chatbotInstructions" TEXT;

CREATE TABLE IF NOT EXISTS "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "ChatDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ChatDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "wamid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_userId_customerPhone_key" ON "ChatConversation"("userId", "customerPhone");
CREATE INDEX IF NOT EXISTS "ChatConversation_userId_lastMessageAt_idx" ON "ChatConversation"("userId", "lastMessageAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_wamid_key" ON "ChatMessage"("wamid");
CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
