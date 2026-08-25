-- CreateTable
CREATE TABLE "AssetIntradayBar" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "barStart" TIMESTAMP(3) NOT NULL,
    "closeEur" DECIMAL(28,12) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetIntradayBar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetIntradayBar_assetId_interval_barStart_idx" ON "AssetIntradayBar"("assetId", "interval", "barStart");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIntradayBar_assetId_interval_barStart_key" ON "AssetIntradayBar"("assetId", "interval", "barStart");

-- AddForeignKey
ALTER TABLE "AssetIntradayBar" ADD CONSTRAINT "AssetIntradayBar_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
