-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "isin" TEXT;

-- CreateIndex
CREATE INDEX "Asset_isin_idx" ON "Asset"("isin");
