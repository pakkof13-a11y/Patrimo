-- Watchlist du tableau de bord : date d'ajout, NULL = non suivi.
ALTER TABLE "Asset" ADD COLUMN "watchlistedAt" TIMESTAMP(3);

CREATE INDEX "Asset_userId_watchlistedAt_idx" ON "Asset"("userId", "watchlistedAt");
