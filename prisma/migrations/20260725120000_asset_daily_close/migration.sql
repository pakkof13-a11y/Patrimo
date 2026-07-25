-- Cache de clôtures journalières par actif (valorisation au marché de
-- l'historique, pour le P&L par classe d'actif).
CREATE TABLE IF NOT EXISTS "AssetDailyClose" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "closeEur" DECIMAL(28,12) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDailyClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssetDailyClose_assetId_day_key"
    ON "AssetDailyClose"("assetId", "day");

CREATE INDEX IF NOT EXISTS "AssetDailyClose_assetId_day_idx"
    ON "AssetDailyClose"("assetId", "day");

ALTER TABLE "AssetDailyClose"
    DROP CONSTRAINT IF EXISTS "AssetDailyClose_assetId_fkey";
ALTER TABLE "AssetDailyClose"
    ADD CONSTRAINT "AssetDailyClose_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
