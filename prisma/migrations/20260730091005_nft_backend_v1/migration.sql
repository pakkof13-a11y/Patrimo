-- NFT backend v1 (chantier G) — voir docs/nft-backend-v1.md, décision D1.
--
-- Sépare l'identité technique d'un NFT (nouvelle table NftAsset) de sa
-- détention (NftItemDetail, conservé). Migration avec backfill : toute ligne
-- NftItemDetail existante obtient une NftAsset (et une NftCollection quand une
-- collection est connue) créée à partir de ses colonnes d'identité actuelles,
-- avant que ces colonnes ne soient supprimées — aucune perte de données, et
-- aucune vérité concurrente ne subsiste après cette migration.
--
-- Note : le drift préexistant sur Liability.platformId (déjà rencontré et
-- écarté lors de la migration DeFi LP v2, cf. commentaire du modèle
-- DefiPositionDetail) n'est pas de nouveau inclus ici — hors périmètre de ce
-- chantier.

-- ═══════════════════════ Nouvelles tables ═══════════════════════

CREATE TABLE "NftCollection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "contractAddress" TEXT,
    "slug" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "standard" TEXT,
    "verifiedStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "spamStatus" TEXT NOT NULL DEFAULT 'CLEAN',
    "creatorName" TEXT,
    "creatorAddress" TEXT,
    "imageUrl" TEXT,
    "bannerUrl" TEXT,
    "externalUrl" TEXT,
    "royaltiesBps" INTEGER,
    "supply" INTEGER,
    "floorPriceNative" DECIMAL(38,18),
    "floorPriceEur" DECIMAL(18,2),
    "floorPriceCurrency" TEXT,
    "floorPriceSource" TEXT,
    "floorPriceUpdatedAt" TIMESTAMP(3),
    "metadataQuality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NftCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "contractAddress" TEXT,
    "tokenId" TEXT,
    "mintAddress" TEXT,
    "uniqueKey" TEXT NOT NULL,
    "collectionId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "animationUrl" TEXT,
    "mediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "metadataUrl" TEXT,
    "externalUrl" TEXT,
    "rawMetadataJson" JSONB,
    "metadataQuality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "contentType" TEXT,
    "isWrapped" BOOLEAN NOT NULL DEFAULT false,
    "isBridged" BOOLEAN NOT NULL DEFAULT false,
    "isCompressed" BOOLEAN NOT NULL DEFAULT false,
    "isSoulbound" BOOLEAN NOT NULL DEFAULT false,
    "isSpam" BOOLEAN NOT NULL DEFAULT false,
    "isScamSuspected" BOOLEAN NOT NULL DEFAULT false,
    "isSensitiveMedia" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "rarityRank" INTEGER,
    "rarityScore" DECIMAL(12,4),
    "lastMetadataRefreshAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NftAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftTrait" (
    "id" TEXT NOT NULL,
    "nftAssetId" TEXT NOT NULL,
    "traitType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "rarityPct" DECIMAL(6,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftTrait_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftMedia" (
    "id" TEXT NOT NULL,
    "nftAssetId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "variant" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftEvent" (
    "id" TEXT NOT NULL,
    "nftAssetId" TEXT NOT NULL,
    "nftHoldingId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "chainId" TEXT,
    "txHash" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "marketplace" TEXT,
    "platformId" TEXT,
    "quantity" DECIMAL(20,0),
    "priceNative" DECIMAL(38,18),
    "priceCurrency" TEXT,
    "priceEur" DECIMAL(18,2),
    "feesNative" DECIMAL(38,18),
    "feesCurrency" TEXT,
    "feesEur" DECIMAL(18,2),
    "royaltyNative" DECIMAL(38,18),
    "royaltyCurrency" TEXT,
    "royaltyEur" DECIMAL(18,2),
    "bundleId" TEXT,
    "ledgerTransactionId" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "rawPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftValuation" (
    "id" TEXT NOT NULL,
    "nftAssetId" TEXT NOT NULL,
    "nftHoldingId" TEXT,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "valuationMethod" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "amountNative" DECIMAL(38,18),
    "amountEur" DECIMAL(18,2),
    "floorPriceNative" DECIMAL(38,18),
    "floorPriceEur" DECIMAL(18,2),
    "lastSaleNative" DECIMAL(38,18),
    "lastSaleEur" DECIMAL(18,2),
    "appraisedValueNative" DECIMAL(38,18),
    "appraisedValueEur" DECIMAL(18,2),
    "confidenceScore" INTEGER,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "rawPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftValuation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NftSyncCursor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "platformId" TEXT,
    "sourceRef" TEXT,
    "scopeKey" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NftSyncCursor_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════ NftItemDetail : nouvelles colonnes ═══════════════════════
-- `nftAssetId` reste nullable à ce stade : le backfill ci-dessous le remplit
-- pour chaque ligne existante, puis NOT NULL est posé en fin de migration.
-- Si une ligne échappait au backfill, cette contrainte ferait échouer toute
-- la migration (transaction annulée) plutôt que de laisser une détention
-- orpheline.

ALTER TABLE "NftItemDetail"
ADD COLUMN     "nftAssetId" TEXT,
ADD COLUMN     "accessMode" TEXT NOT NULL DEFAULT 'SELF_CUSTODY',
ADD COLUMN     "custodyModel" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "dataOrigin" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "ownerLabel" TEXT,
ADD COLUMN     "ownershipShare" DECIMAL(6,3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'HELD',
ADD COLUMN     "acquisitionDate" TIMESTAMP(3),
ADD COLUMN     "disposalDate" TIMESTAMP(3),
ADD COLUMN     "acquisitionSource" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "disposalSource" TEXT,
ADD COLUMN     "acquisitionTxHash" TEXT,
ADD COLUMN     "disposalTxHash" TEXT,
ADD COLUMN     "acquisitionCostNative" DECIMAL(38,18),
ADD COLUMN     "acquisitionCurrency" TEXT,
ADD COLUMN     "acquisitionCostEur" DECIMAL(18,2),
ADD COLUMN     "manualAcquisitionCostEur" DECIMAL(18,2),
ADD COLUMN     "retainedValueEur" DECIMAL(18,2),
ADD COLUMN     "retainedValueMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "retainedValueUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "isIgnoredInPortfolio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkedHoldingId" TEXT,
ADD COLUMN     "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "conflictReason" TEXT,
ADD COLUMN     "providerKey" TEXT;

-- Reprend la date d'acquisition depuis l'Asset existant (déjà porteur de ce
-- champ) plutôt que de la laisser vide pour l'historique.
UPDATE "NftItemDetail" nid
SET "acquisitionDate" = a."acquisitionDate"
FROM "Asset" a
WHERE a.id = nid."assetId" AND a."acquisitionDate" IS NOT NULL;

-- ═══════════════════════ Backfill identité → NftAsset / NftCollection ═══════════════════════
-- IDs déterministes (préfixés depuis l'id existant, jamais générés au hasard)
-- pour que le lien détention → identité soit exact sans dépendre d'une
-- fonction d'UUID côté serveur.

WITH old_items AS (
  SELECT
    nid.id AS item_id,
    a."userId" AS user_id,
    lower(nid.chain) AS chain_id,
    nid."contractAddr" AS contract_address,
    nid."tokenId" AS token_id,
    nid.standard AS standard,
    nid."collectionName" AS collection_name,
    nid."collectionSlug" AS collection_slug,
    nid."imageUrl" AS image_url,
    nid."metadataUrl" AS metadata_url,
    nid."rarityRank" AS rarity_rank,
    nid."rarityScore" AS rarity_score
  FROM "NftItemDetail" nid
  JOIN "Asset" a ON a.id = nid."assetId"
),
collections AS (
  SELECT DISTINCT ON (user_id, chain_id, COALESCE(collection_slug, collection_name))
    'bkc_' || md5(user_id || '|' || chain_id || '|' || COALESCE(collection_slug, collection_name, '')) AS collection_id,
    user_id,
    chain_id,
    collection_slug,
    collection_name
  FROM old_items
  WHERE collection_slug IS NOT NULL OR collection_name IS NOT NULL
),
inserted_collections AS (
  INSERT INTO "NftCollection" (
    "id", "userId", "chainId", "slug", "name",
    "verifiedStatus", "spamStatus", "metadataQuality", "createdAt", "updatedAt"
  )
  SELECT
    collection_id, user_id, chain_id, collection_slug,
    COALESCE(collection_name, collection_slug, 'Collection inconnue'),
    'UNKNOWN', 'CLEAN', 'UNKNOWN', now(), now()
  FROM collections
  RETURNING id
),
items_with_collection AS (
  SELECT
    oi.*,
    c.collection_id
  FROM old_items oi
  LEFT JOIN collections c
    ON c.user_id = oi.user_id
   AND c.chain_id = oi.chain_id
   AND COALESCE(c.collection_slug, c.collection_name) = COALESCE(oi.collection_slug, oi.collection_name)
   AND (oi.collection_slug IS NOT NULL OR oi.collection_name IS NOT NULL)
),
inserted_assets AS (
  INSERT INTO "NftAsset" (
    "id", "userId", "chainId", "standard", "contractAddress", "tokenId", "mintAddress",
    "uniqueKey", "collectionId", "name", "imageUrl", "metadataUrl",
    "metadataQuality", "category", "rarityRank", "rarityScore",
    "createdAt", "updatedAt"
  )
  SELECT
    'bk_' || item_id,
    user_id,
    chain_id,
    -- Heuristique de repli : le standard n'était pas toujours renseigné avant
    -- ce chantier. SPL pour Solana, ERC_721 sinon (cas le plus courant).
    COALESCE(standard, CASE WHEN chain_id = 'solana' THEN 'SPL' ELSE 'ERC_721' END),
    CASE WHEN chain_id = 'solana' THEN NULL ELSE lower(contract_address) END,
    CASE WHEN chain_id = 'solana' THEN NULL ELSE token_id END,
    CASE WHEN chain_id = 'solana' THEN token_id ELSE NULL END,
    CASE
      WHEN chain_id = 'solana' THEN 'sol:' || chain_id || ':' || COALESCE(token_id, item_id)
      WHEN contract_address IS NOT NULL THEN 'evm:' || chain_id || ':' || lower(contract_address) || ':' || COALESCE(token_id, '')
      ELSE 'manual:' || item_id
    END,
    collection_id,
    collection_name,
    image_url,
    metadata_url,
    'UNKNOWN',
    'UNKNOWN',
    rarity_rank,
    rarity_score,
    now(),
    now()
  FROM items_with_collection
  RETURNING id
)
UPDATE "NftItemDetail" nid
SET "nftAssetId" = 'bk_' || nid.id
WHERE EXISTS (SELECT 1 FROM inserted_assets ia WHERE ia.id = 'bk_' || nid.id);

-- Colonnes d'identité de NftItemDetail devenues redondantes avec NftAsset.
ALTER TABLE "NftItemDetail"
ALTER COLUMN "nftAssetId" SET NOT NULL,
DROP COLUMN "chain",
DROP COLUMN "collectionName",
DROP COLUMN "collectionSlug",
DROP COLUMN "contractAddr",
DROP COLUMN "estimateDate",
DROP COLUMN "estimateSource",
DROP COLUMN "floorPriceCurrency",
DROP COLUMN "floorPriceEur",
DROP COLUMN "floorPriceNative",
DROP COLUMN "imageUrl",
DROP COLUMN "lastValuedAt",
DROP COLUMN "metadataUrl",
DROP COLUMN "rarityRank",
DROP COLUMN "rarityScore",
DROP COLUMN "standard",
DROP COLUMN "tokenId",
DROP COLUMN "valuationMode";

-- `NftItemDetail_chain_idx` et `NftItemDetail_collectionSlug_idx` sont
-- supprimés automatiquement par Postgres avec les colonnes ci-dessus.

-- ═══════════════════════ Index ═══════════════════════

CREATE INDEX "NftCollection_userId_idx" ON "NftCollection"("userId");
CREATE INDEX "NftCollection_userId_chainId_contractAddress_idx" ON "NftCollection"("userId", "chainId", "contractAddress");
CREATE INDEX "NftCollection_userId_slug_idx" ON "NftCollection"("userId", "slug");
CREATE INDEX "NftCollection_spamStatus_idx" ON "NftCollection"("spamStatus");
CREATE INDEX "NftCollection_verifiedStatus_idx" ON "NftCollection"("verifiedStatus");

CREATE INDEX "NftAsset_userId_idx" ON "NftAsset"("userId");
CREATE INDEX "NftAsset_chainId_contractAddress_tokenId_idx" ON "NftAsset"("chainId", "contractAddress", "tokenId");
CREATE INDEX "NftAsset_mintAddress_idx" ON "NftAsset"("mintAddress");
CREATE INDEX "NftAsset_collectionId_idx" ON "NftAsset"("collectionId");
CREATE INDEX "NftAsset_isSpam_idx" ON "NftAsset"("isSpam");
CREATE INDEX "NftAsset_isScamSuspected_idx" ON "NftAsset"("isScamSuspected");
CREATE INDEX "NftAsset_category_idx" ON "NftAsset"("category");
CREATE UNIQUE INDEX "NftAsset_userId_uniqueKey_key" ON "NftAsset"("userId", "uniqueKey");

CREATE INDEX "NftTrait_nftAssetId_idx" ON "NftTrait"("nftAssetId");
CREATE INDEX "NftTrait_traitType_idx" ON "NftTrait"("traitType");
CREATE UNIQUE INDEX "NftTrait_nftAssetId_traitType_value_key" ON "NftTrait"("nftAssetId", "traitType", "value");

CREATE INDEX "NftMedia_nftAssetId_idx" ON "NftMedia"("nftAssetId");
CREATE INDEX "NftMedia_mediaType_idx" ON "NftMedia"("mediaType");

CREATE INDEX "NftEvent_nftAssetId_idx" ON "NftEvent"("nftAssetId");
CREATE INDEX "NftEvent_nftAssetId_eventDate_idx" ON "NftEvent"("nftAssetId", "eventDate");
CREATE INDEX "NftEvent_nftHoldingId_idx" ON "NftEvent"("nftHoldingId");
CREATE INDEX "NftEvent_eventType_idx" ON "NftEvent"("eventType");
CREATE INDEX "NftEvent_eventDate_idx" ON "NftEvent"("eventDate");
CREATE INDEX "NftEvent_txHash_idx" ON "NftEvent"("txHash");
CREATE INDEX "NftEvent_ledgerTransactionId_idx" ON "NftEvent"("ledgerTransactionId");
CREATE UNIQUE INDEX "NftEvent_nftAssetId_txHash_eventType_key" ON "NftEvent"("nftAssetId", "txHash", "eventType");

CREATE INDEX "NftValuation_nftAssetId_idx" ON "NftValuation"("nftAssetId");
CREATE INDEX "NftValuation_nftAssetId_valuationDate_idx" ON "NftValuation"("nftAssetId", "valuationDate");
CREATE INDEX "NftValuation_nftHoldingId_idx" ON "NftValuation"("nftHoldingId");
CREATE INDEX "NftValuation_valuationDate_idx" ON "NftValuation"("valuationDate");
CREATE INDEX "NftValuation_valuationMethod_idx" ON "NftValuation"("valuationMethod");
CREATE INDEX "NftValuation_isManual_idx" ON "NftValuation"("isManual");
CREATE UNIQUE INDEX "NftValuation_nftAssetId_valuationDate_key" ON "NftValuation"("nftAssetId", "valuationDate");

CREATE INDEX "NftSyncCursor_userId_idx" ON "NftSyncCursor"("userId");
CREATE INDEX "NftSyncCursor_provider_idx" ON "NftSyncCursor"("provider");
CREATE INDEX "NftSyncCursor_platformId_idx" ON "NftSyncCursor"("platformId");
CREATE INDEX "NftSyncCursor_userId_provider_idx" ON "NftSyncCursor"("userId", "provider");
CREATE UNIQUE INDEX "NftSyncCursor_userId_provider_scopeKey_key" ON "NftSyncCursor"("userId", "provider", "scopeKey");

CREATE INDEX "NftItemDetail_nftAssetId_idx" ON "NftItemDetail"("nftAssetId");
CREATE INDEX "NftItemDetail_accessMode_idx" ON "NftItemDetail"("accessMode");
CREATE INDEX "NftItemDetail_status_idx" ON "NftItemDetail"("status");
CREATE INDEX "NftItemDetail_dataOrigin_idx" ON "NftItemDetail"("dataOrigin");
CREATE INDEX "NftItemDetail_isHidden_isIgnoredInPortfolio_idx" ON "NftItemDetail"("isHidden", "isIgnoredInPortfolio");
CREATE INDEX "NftItemDetail_acquisitionDate_idx" ON "NftItemDetail"("acquisitionDate");
CREATE INDEX "NftItemDetail_disposalDate_idx" ON "NftItemDetail"("disposalDate");
CREATE INDEX "NftItemDetail_linkedHoldingId_idx" ON "NftItemDetail"("linkedHoldingId");
CREATE INDEX "NftItemDetail_providerKey_idx" ON "NftItemDetail"("providerKey");

-- ═══════════════════════ Clés étrangères ═══════════════════════

ALTER TABLE "NftCollection" ADD CONSTRAINT "NftCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftAsset" ADD CONSTRAINT "NftAsset_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "NftCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftAsset" ADD CONSTRAINT "NftAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftTrait" ADD CONSTRAINT "NftTrait_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NftAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftMedia" ADD CONSTRAINT "NftMedia_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NftAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftItemDetail" ADD CONSTRAINT "NftItemDetail_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NftAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NftItemDetail" ADD CONSTRAINT "NftItemDetail_linkedHoldingId_fkey" FOREIGN KEY ("linkedHoldingId") REFERENCES "NftItemDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NftAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_nftHoldingId_fkey" FOREIGN KEY ("nftHoldingId") REFERENCES "NftItemDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftValuation" ADD CONSTRAINT "NftValuation_nftAssetId_fkey" FOREIGN KEY ("nftAssetId") REFERENCES "NftAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftValuation" ADD CONSTRAINT "NftValuation_nftHoldingId_fkey" FOREIGN KEY ("nftHoldingId") REFERENCES "NftItemDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NftSyncCursor" ADD CONSTRAINT "NftSyncCursor_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NftSyncCursor" ADD CONSTRAINT "NftSyncCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
