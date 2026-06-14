-- AlterTable
ALTER TABLE "Raffle" ADD COLUMN     "bannerMobileUrl" TEXT,
ADD COLUMN     "bannerUrl" TEXT,
ADD COLUMN     "buyDeadline" TIMESTAMP(3),
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#7c3aed',
ADD COLUMN     "contactWhatsapp" TEXT,
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "loteria" TEXT,
ADD COLUMN     "representanteCedula" TEXT,
ADD COLUMN     "representanteLegal" TEXT;
