-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "phone" TEXT,
    "idDocument" TEXT,
    "email" TEXT,
    "wallet" TEXT,
    "holderName" TEXT,
    "accountNumber" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAccount_userId_idx" ON "PaymentAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_userId_method_key" ON "PaymentAccount"("userId", "method");

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
