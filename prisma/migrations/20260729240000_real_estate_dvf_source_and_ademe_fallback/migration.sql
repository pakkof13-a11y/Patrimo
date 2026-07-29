-- Traçabilité de la source d'estimation, et repli commune × DPE.
--
-- `dvfSource` est additive et nullable, aucun backfill : les biens déjà
-- évalués gardent une source inconnue jusqu'à leur prochaine réévaluation.
--
-- `AdemeCommuneDpeMedian` est une nouvelle table, publique comme `DvfSale`
-- (pas de userId) — elle est créée vide ici, voir `ademe-reference.ts`.

ALTER TABLE "RealEstateDetail"
  ADD COLUMN "dvfSource" TEXT;

CREATE TABLE "AdemeCommuneDpeMedian" (
  "id" TEXT NOT NULL,
  "inseeCode" TEXT NOT NULL,
  "energyRating" TEXT NOT NULL,
  "medianPricePerM2" DECIMAL(12,2) NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdemeCommuneDpeMedian_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdemeCommuneDpeMedian_inseeCode_energyRating_key"
  ON "AdemeCommuneDpeMedian"("inseeCode", "energyRating");

CREATE INDEX "AdemeCommuneDpeMedian_inseeCode_idx"
  ON "AdemeCommuneDpeMedian"("inseeCode");
