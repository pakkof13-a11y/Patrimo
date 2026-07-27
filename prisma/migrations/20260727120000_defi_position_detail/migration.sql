-- Position DeFi : extension 1:1 d'un Asset (le journal porte la valeur).
CREATE TABLE "DefiPositionDetail" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "protocolLogo" TEXT,
    "chain" TEXT,
    "positionType" TEXT NOT NULL,
    "pairedSymbol" TEXT,
    "pairedAmount" DECIMAL(38,18),
    "poolAddress" TEXT,
    "apyPct" DECIMAL(9,4),
    "rewardsSymbol" TEXT,
    "rewardsAmount" DECIMAL(38,18),
    "rewardsValueEur" DECIMAL(18,2),
    "healthFactor" DECIMAL(12,4),
    "ltvPct" DECIMAL(6,3),
    "liqThresholdPct" DECIMAL(6,3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastSyncedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefiPositionDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DefiPositionDetail_assetId_key" ON "DefiPositionDetail"("assetId");
CREATE INDEX "DefiPositionDetail_protocol_idx" ON "DefiPositionDetail"("protocol");
CREATE INDEX "DefiPositionDetail_positionType_idx" ON "DefiPositionDetail"("positionType");

ALTER TABLE "DefiPositionDetail" ADD CONSTRAINT "DefiPositionDetail_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
