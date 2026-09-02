-- Caractéristiques d'un bien immobilier — extension 1:1 de Asset.
-- La quote-part de détention n'est PAS ici : elle est portée par la quantity
-- des transactions (0,5 = 50 % du bien), pour que la valorisation se déduise
-- sans calcul spécifique.
CREATE TABLE IF NOT EXISTS "RealEstateDetail" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "rooms" INTEGER,
    "livingAreaM2" INTEGER,
    "landAreaM2" INTEGER,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "inseeCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3),
    "valuationMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastValuedAt" TIMESTAMP(3),
    "dvfEstimateEur" DECIMAL(14,2),
    "dvfConfidence" TEXT,
    "dvfComparables" INTEGER,
    "monthlyRentEur" DECIMAL(12,2),
    "monthlyChargesEur" DECIMAL(12,2),
    "annualPropertyTaxEur" DECIMAL(12,2),
    "occupancyRatePct" DECIMAL(5,2),
    "constructionYear" INTEGER,
    "energyRating" TEXT,
    "parkingSpots" INTEGER,
    "floor" INTEGER,
    "hasElevator" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealEstateDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RealEstateDetail_assetId_key"
    ON "RealEstateDetail"("assetId");

ALTER TABLE "RealEstateDetail" DROP CONSTRAINT IF EXISTS "RealEstateDetail_assetId_fkey";
ALTER TABLE "RealEstateDetail"
    ADD CONSTRAINT "RealEstateDetail_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rattachement optionnel d'un prêt à un bien. Sert à l'attribution (net par
-- bien) : le patrimoine net global déduit déjà tous les passifs.
ALTER TABLE "Liability" ADD COLUMN IF NOT EXISTS "assetId" TEXT;

CREATE INDEX IF NOT EXISTS "Liability_assetId_idx" ON "Liability"("assetId");

ALTER TABLE "Liability" DROP CONSTRAINT IF EXISTS "Liability_assetId_fkey";
ALTER TABLE "Liability"
    ADD CONSTRAINT "Liability_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
