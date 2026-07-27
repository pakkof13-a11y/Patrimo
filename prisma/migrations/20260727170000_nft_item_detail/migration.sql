-- NFT : extension 1:1 d'un Asset (le journal porte la valeur, comme pour
-- l'immobilier et la DeFi).
CREATE TABLE "NftItemDetail" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "contractAddr" TEXT,
    "chain" TEXT NOT NULL,
    "collectionName" TEXT,
    "collectionSlug" TEXT,
    "imageUrl" TEXT,
    "metadataUrl" TEXT,
    "standard" TEXT,
    "valuationMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastValuedAt" TIMESTAMP(3),
    "floorPriceNative" DECIMAL(24,10),
    "floorPriceCurrency" TEXT,
    "floorPriceEur" DECIMAL(18,2),
    "estimateSource" TEXT,
    "estimateDate" TIMESTAMP(3),
    "rarityRank" INTEGER,
    "rarityScore" DECIMAL(10,4),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NftItemDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftItemDetail_assetId_key" ON "NftItemDetail"("assetId");
CREATE INDEX "NftItemDetail_chain_idx" ON "NftItemDetail"("chain");
CREATE INDEX "NftItemDetail_collectionSlug_idx" ON "NftItemDetail"("collectionSlug");

ALTER TABLE "NftItemDetail" ADD CONSTRAINT "NftItemDetail_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
