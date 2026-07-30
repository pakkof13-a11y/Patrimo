-- Backend DeFi / CeFi / CeDeFi — chantier F1.
--
-- Strictement additif : colonnes de contexte sur DefiPositionDetail (toutes
-- avec un défaut, donc sans réécriture des lignes existantes) et sept tables
-- satellites. Aucune donnée existante n'est touchée, aucune colonne supprimée.
--
-- Cf. docs/defi-backend-v1.md pour les décisions d'architecture.

-- AlterTable
ALTER TABLE "DefiPositionDetail" ADD COLUMN     "accessMode" TEXT NOT NULL DEFAULT 'DEFI',
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "conflictReason" TEXT,
ADD COLUMN     "custodyModel" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "dataOrigin" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isIgnoredInPortfolio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkedPositionId" TEXT,
ADD COLUMN     "marketRef" TEXT,
ADD COLUMN     "nftPositionRef" TEXT,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "ownerLabel" TEXT,
ADD COLUMN     "ownershipPct" DECIMAL(6,3),
ADD COLUMN     "poolRef" TEXT,
ADD COLUMN     "protocolVersion" TEXT,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "underlyingProtocol" TEXT,
ADD COLUMN     "validatorName" TEXT,
ADD COLUMN     "vaultRef" TEXT;

-- CreateTable
CREATE TABLE "DefiLeg" (
    "id" TEXT NOT NULL,
    "defiPositionId" TEXT NOT NULL,
    "legType" TEXT NOT NULL,
    "assetId" TEXT,
    "symbol" TEXT NOT NULL,
    "tokenRole" TEXT,
    "quantity" DECIMAL(38,18) NOT NULL,
    "unitCostNative" DECIMAL(38,18),
    "unitCostEur" DECIMAL(28,12),
    "totalCostEur" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "DefiLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiEvent" (
    "id" TEXT NOT NULL,
    "defiPositionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "chainId" TEXT,
    "txHash" TEXT,
    "assetId" TEXT,
    "symbol" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "quantity" DECIMAL(38,18),
    "amountNative" DECIMAL(38,18),
    "amountEur" DECIMAL(18,2),
    "feesNative" DECIMAL(38,18),
    "feesEur" DECIMAL(18,2),
    "relatedProtocol" TEXT,
    "ledgerTransactionId" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "rawPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "DefiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiValuation" (
    "id" TEXT NOT NULL,
    "defiPositionId" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "valuationMethod" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "grossValueEur" DECIMAL(18,2),
    "netValueEur" DECIMAL(18,2),
    "debtValueEur" DECIMAL(18,2),
    "collateralValueEur" DECIMAL(18,2),
    "rewardsValueEur" DECIMAL(18,2),
    "retainedValueEur" DECIMAL(18,2),
    "lpUnderlyingValueEur" DECIMAL(18,2),
    "feesAccruedEur" DECIMAL(18,2),
    "confidenceScore" INTEGER,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "rawPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "DefiValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiReward" (
    "id" TEXT NOT NULL,
    "defiPositionId" TEXT NOT NULL,
    "assetId" TEXT,
    "symbol" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL DEFAULT 'YIELD',
    "accruedQuantity" DECIMAL(38,18),
    "claimedQuantity" DECIMAL(38,18),
    "valueEur" DECIMAL(18,2),
    "sourceLabel" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "DefiReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiSyncCursor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "platformId" TEXT,
    "sourceRef" TEXT,
    "cursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "DefiSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiProtocolRef" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "category" TEXT,
    "logoUrl" TEXT,
    "primaryChain" TEXT,
    "websiteUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "DefiProtocolRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefiMarketRef" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocolRefId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'POOL',
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chain" TEXT,
    "contractAddress" TEXT,
    "tokenSymbols" TEXT,
    "feeTierPct" DECIMAL(9,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "DefiMarketRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefiLeg_defiPositionId_idx" ON "DefiLeg"("defiPositionId");

-- CreateIndex
CREATE INDEX "DefiLeg_defiPositionId_legType_idx" ON "DefiLeg"("defiPositionId", "legType");

-- CreateIndex
CREATE INDEX "DefiLeg_assetId_idx" ON "DefiLeg"("assetId");

-- CreateIndex
CREATE INDEX "DefiLeg_legType_isActive_idx" ON "DefiLeg"("legType", "isActive");

-- CreateIndex
CREATE INDEX "DefiLeg_symbol_idx" ON "DefiLeg"("symbol");

-- CreateIndex
CREATE INDEX "DefiEvent_defiPositionId_idx" ON "DefiEvent"("defiPositionId");

-- CreateIndex
CREATE INDEX "DefiEvent_defiPositionId_eventDate_idx" ON "DefiEvent"("defiPositionId", "eventDate");

-- CreateIndex
CREATE INDEX "DefiEvent_eventType_idx" ON "DefiEvent"("eventType");

-- CreateIndex
CREATE INDEX "DefiEvent_eventDate_idx" ON "DefiEvent"("eventDate");

-- CreateIndex
CREATE INDEX "DefiEvent_txHash_idx" ON "DefiEvent"("txHash");

-- CreateIndex
CREATE INDEX "DefiEvent_ledgerTransactionId_idx" ON "DefiEvent"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "DefiEvent_defiPositionId_txHash_eventType_key" ON "DefiEvent"("defiPositionId", "txHash", "eventType");

-- CreateIndex
CREATE INDEX "DefiValuation_defiPositionId_idx" ON "DefiValuation"("defiPositionId");

-- CreateIndex
CREATE INDEX "DefiValuation_defiPositionId_valuationDate_idx" ON "DefiValuation"("defiPositionId", "valuationDate");

-- CreateIndex
CREATE INDEX "DefiValuation_valuationDate_idx" ON "DefiValuation"("valuationDate");

-- CreateIndex
CREATE INDEX "DefiValuation_valuationMethod_idx" ON "DefiValuation"("valuationMethod");

-- CreateIndex
CREATE INDEX "DefiValuation_isManual_idx" ON "DefiValuation"("isManual");

-- CreateIndex
CREATE UNIQUE INDEX "DefiValuation_defiPositionId_valuationDate_key" ON "DefiValuation"("defiPositionId", "valuationDate");

-- CreateIndex
CREATE INDEX "DefiReward_defiPositionId_idx" ON "DefiReward"("defiPositionId");

-- CreateIndex
CREATE INDEX "DefiReward_symbol_idx" ON "DefiReward"("symbol");

-- CreateIndex
CREATE INDEX "DefiReward_rewardType_idx" ON "DefiReward"("rewardType");

-- CreateIndex
CREATE UNIQUE INDEX "DefiReward_defiPositionId_symbol_rewardType_key" ON "DefiReward"("defiPositionId", "symbol", "rewardType");

-- CreateIndex
CREATE INDEX "DefiSyncCursor_userId_idx" ON "DefiSyncCursor"("userId");

-- CreateIndex
CREATE INDEX "DefiSyncCursor_provider_idx" ON "DefiSyncCursor"("provider");

-- CreateIndex
CREATE INDEX "DefiSyncCursor_platformId_idx" ON "DefiSyncCursor"("platformId");

-- CreateIndex
CREATE INDEX "DefiSyncCursor_userId_provider_idx" ON "DefiSyncCursor"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "DefiSyncCursor_userId_provider_platformId_sourceRef_key" ON "DefiSyncCursor"("userId", "provider", "platformId", "sourceRef");

-- CreateIndex
CREATE INDEX "DefiProtocolRef_userId_idx" ON "DefiProtocolRef"("userId");

-- CreateIndex
CREATE INDEX "DefiProtocolRef_slug_idx" ON "DefiProtocolRef"("slug");

-- CreateIndex
CREATE INDEX "DefiProtocolRef_category_idx" ON "DefiProtocolRef"("category");

-- CreateIndex
CREATE UNIQUE INDEX "DefiProtocolRef_userId_slug_key" ON "DefiProtocolRef"("userId", "slug");

-- CreateIndex
CREATE INDEX "DefiMarketRef_userId_idx" ON "DefiMarketRef"("userId");

-- CreateIndex
CREATE INDEX "DefiMarketRef_protocolRefId_idx" ON "DefiMarketRef"("protocolRefId");

-- CreateIndex
CREATE INDEX "DefiMarketRef_chain_idx" ON "DefiMarketRef"("chain");

-- CreateIndex
CREATE INDEX "DefiMarketRef_kind_idx" ON "DefiMarketRef"("kind");

-- CreateIndex
CREATE INDEX "DefiMarketRef_contractAddress_idx" ON "DefiMarketRef"("contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DefiMarketRef_userId_kind_slug_key" ON "DefiMarketRef"("userId", "kind", "slug");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_accessMode_idx" ON "DefiPositionDetail"("accessMode");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_status_idx" ON "DefiPositionDetail"("status");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_dataOrigin_idx" ON "DefiPositionDetail"("dataOrigin");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_isHidden_isIgnoredInPortfolio_idx" ON "DefiPositionDetail"("isHidden", "isIgnoredInPortfolio");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_chain_protocol_positionType_idx" ON "DefiPositionDetail"("chain", "protocol", "positionType");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_openedAt_idx" ON "DefiPositionDetail"("openedAt");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_closedAt_idx" ON "DefiPositionDetail"("closedAt");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_providerKey_idx" ON "DefiPositionDetail"("providerKey");

-- CreateIndex
CREATE INDEX "DefiPositionDetail_linkedPositionId_idx" ON "DefiPositionDetail"("linkedPositionId");

-- AddForeignKey
ALTER TABLE "DefiPositionDetail" ADD CONSTRAINT "DefiPositionDetail_linkedPositionId_fkey" FOREIGN KEY ("linkedPositionId") REFERENCES "DefiPositionDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiLeg" ADD CONSTRAINT "DefiLeg_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiLeg" ADD CONSTRAINT "DefiLeg_defiPositionId_fkey" FOREIGN KEY ("defiPositionId") REFERENCES "DefiPositionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiEvent" ADD CONSTRAINT "DefiEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiEvent" ADD CONSTRAINT "DefiEvent_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiEvent" ADD CONSTRAINT "DefiEvent_defiPositionId_fkey" FOREIGN KEY ("defiPositionId") REFERENCES "DefiPositionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiValuation" ADD CONSTRAINT "DefiValuation_defiPositionId_fkey" FOREIGN KEY ("defiPositionId") REFERENCES "DefiPositionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiReward" ADD CONSTRAINT "DefiReward_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiReward" ADD CONSTRAINT "DefiReward_defiPositionId_fkey" FOREIGN KEY ("defiPositionId") REFERENCES "DefiPositionDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiSyncCursor" ADD CONSTRAINT "DefiSyncCursor_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiSyncCursor" ADD CONSTRAINT "DefiSyncCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiProtocolRef" ADD CONSTRAINT "DefiProtocolRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiMarketRef" ADD CONSTRAINT "DefiMarketRef_protocolRefId_fkey" FOREIGN KEY ("protocolRefId") REFERENCES "DefiProtocolRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefiMarketRef" ADD CONSTRAINT "DefiMarketRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
