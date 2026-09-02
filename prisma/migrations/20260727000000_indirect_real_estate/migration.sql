-- Véhicules immobiliers indirects (SCPI, SCI, OPCI, foncières).
--
-- Extension 1:1 de Asset, comme RealEstateDetail : la valeur reste au
-- journal (parts × prix de part). Seules les caractéristiques du véhicule
-- sont stockées ici, dont la quote-part immobilière imposable à l'IFI que
-- rien ne permettait de renseigner jusqu'ici.
CREATE TABLE "IndirectRealEstateDetail" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "vehicle" TEXT NOT NULL,
  "manager" TEXT,
  "distributionRatePct" DECIMAL(6,3),
  "debtRatioPct" DECIMAL(6,3),
  "realEstateSharePct" DECIMAL(6,3),
  "ownershipStakePct" DECIMAL(9,6),
  "ifiExcluded" BOOLEAN NOT NULL DEFAULT false,
  "taxTransparency" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndirectRealEstateDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndirectRealEstateDetail_assetId_key"
  ON "IndirectRealEstateDetail"("assetId");

ALTER TABLE "IndirectRealEstateDetail"
  ADD CONSTRAINT "IndirectRealEstateDetail_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
