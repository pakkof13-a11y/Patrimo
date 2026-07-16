-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM (
  'EQUITY',
  'ETF',
  'BOND',
  'MONEY_MARKET',
  'FUND',
  'REIT',
  'CRYPTO',
  'CASH_EQUIVALENT',
  'SCPI',
  'REAL_ESTATE_DIRECT',
  'PRIVATE_EQUITY',
  'COMMODITY',
  'DERIVATIVE',
  'OTHER',
  'UNCLASSIFIED'
);

-- AlterTable — non destructif, défaut Non classé
ALTER TABLE "Asset" ADD COLUMN "category" "AssetCategory" NOT NULL DEFAULT 'UNCLASSIFIED';

-- Backfill prudent (assetClass fiable uniquement — pas de ticker)
UPDATE "Asset" SET "category" = 'CRYPTO' WHERE "assetClass" = 'CRYPTO';
UPDATE "Asset" SET "category" = 'BOND' WHERE "assetClass" = 'OBLIGATIONS';
UPDATE "Asset" SET "category" = 'CASH_EQUIVALENT' WHERE "assetClass" = 'CASH';
-- SCPI si le nom le mentionne explicitement (évite de deviner un ticker)
UPDATE "Asset" SET "category" = 'SCPI'
WHERE "assetClass" = 'IMMOBILIER' AND (
  "name" ILIKE '%SCPI%' OR "ticker" ILIKE '%SCPI%'
);
UPDATE "Asset" SET "category" = 'REAL_ESTATE_DIRECT'
WHERE "assetClass" = 'IMMOBILIER'
  AND "category" = 'UNCLASSIFIED'
  AND (
    "name" ILIKE '%Appartement%'
    OR "name" ILIKE '%Maison%'
    OR "name" ILIKE '%Immeuble%'
    OR "name" ILIKE '%Locatif%'
  );
UPDATE "Asset" SET "category" = 'DERIVATIVE'
WHERE "accountType" = 'CFD' AND "category" = 'UNCLASSIFIED';

-- CreateIndex
CREATE INDEX "Asset_userId_category_idx" ON "Asset"("userId", "category");
