-- Immobilier — équipements complémentaires (Groupe F) et risques Géorisques.
--
-- Migration additive uniquement — colonnes nullables, aucun backfill.
-- `georisquesFetched` a un default (`false`) car c'est un booléen d'état, pas
-- une caractéristique du bien : les lignes existantes n'ont simplement jamais
-- été interrogées, ce qui est exactement ce que `false` signifie.

ALTER TABLE "RealEstateDetail"
  -- Équipements complémentaires
  ADD COLUMN "hasPool" BOOLEAN,
  ADD COLUMN "bathroomCount" INTEGER,
  ADD COLUMN "hasAirConditioning" BOOLEAN,
  ADD COLUMN "hasFireplace" BOOLEAN,
  ADD COLUMN "hasAlarm" BOOLEAN,
  -- Risques (Géorisques)
  ADD COLUMN "riskFlood" TEXT,
  ADD COLUMN "riskSeismic" TEXT,
  ADD COLUMN "riskRadon" TEXT,
  ADD COLUMN "riskClaySoil" TEXT,
  ADD COLUMN "georisquesFetched" BOOLEAN NOT NULL DEFAULT false;
