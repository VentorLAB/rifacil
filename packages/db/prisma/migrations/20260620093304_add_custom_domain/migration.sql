-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_customDomain_key" ON "User"("customDomain");
