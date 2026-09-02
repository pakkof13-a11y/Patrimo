-- Immobilier — caractéristiques descriptives (vague 1) : physique, état
-- énergétique, copropriété et fiscalité locale.
--
-- Migration additive uniquement — toutes les colonnes sont nullables, sans
-- default à appliquer : aucune ligne existante n'est réécrite (zéro
-- backfill). `constructionYear`, `energyRating` (DPE), `parkingSpots`,
-- `floor`, `hasElevator` et `annualPropertyTaxEur` existent déjà et ne sont
-- pas dupliqués ici.

ALTER TABLE "RealEstateDetail"
  -- Physique
  ADD COLUMN "totalFloors" INTEGER,
  ADD COLUMN "orientation" TEXT,
  ADD COLUMN "viewType" TEXT,
  ADD COLUMN "hasBalcony" BOOLEAN,
  ADD COLUMN "balconyAreaM2" INTEGER,
  ADD COLUMN "hasGarden" BOOLEAN,
  ADD COLUMN "gardenAreaM2" INTEGER,
  ADD COLUMN "hasCellar" BOOLEAN,
  -- État et performance énergétique
  ADD COLUMN "gesRating" TEXT,
  ADD COLUMN "dpeKwhM2Year" INTEGER,
  ADD COLUMN "heatingType" TEXT,
  ADD COLUMN "windowQuality" TEXT,
  -- Copropriété
  ADD COLUMN "isCopropriete" BOOLEAN,
  ADD COLUMN "annualCoproChargesEur" DECIMAL(12,2),
  ADD COLUMN "annualCoproProvisions" DECIMAL(12,2),
  -- Fiscalité locale
  ADD COLUMN "annualHabitationTaxEur" DECIMAL(12,2);
