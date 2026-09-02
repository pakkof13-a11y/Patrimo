-- AlterTable
ALTER TABLE "PriceHistory" ADD COLUMN     "granularity" TEXT,
ADD COLUMN     "marketAt" TIMESTAMP(3),
ADD COLUMN     "nativeCurrency" TEXT,
ADD COLUMN     "priceNative" DECIMAL(28,12);

-- CreateIndex
CREATE INDEX "PriceHistory_assetId_marketAt_idx" ON "PriceHistory"("assetId", "marketAt");
