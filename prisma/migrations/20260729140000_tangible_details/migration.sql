-- Actifs tangibles : l'objet cesse d'être un libellé et un prix.
--
-- Migration strictement additive — toutes les colonnes sont nullable ou ont
-- une valeur par défaut. Aucune ligne existante n'est réécrite, et les
-- catégories déjà en base restent valides : les nouvelles ne font que
-- s'ajouter à la liste acceptée côté application.
--
-- `purchaseDate` est la colonne qui débloque la fiscalité : sans date d'achat,
-- l'abattement pour durée de détention de l'article 150 VI est incalculable.

ALTER TABLE "TangibleAsset"
  -- Acquisition
  ADD COLUMN "purchaseDate"      TIMESTAMP(3),
  ADD COLUMN "purchaseSource"    TEXT,
  ADD COLUMN "certificateRef"    TEXT,
  ADD COLUMN "certificateIssuer" TEXT,

  -- Valorisation & conservation
  ADD COLUMN "appraisalValue"  DECIMAL(28,12),
  ADD COLUMN "appraisalDate"   TIMESTAMP(3),
  ADD COLUMN "insuranceValue"  DECIMAL(28,12),
  ADD COLUMN "storageLocation" TEXT,

  -- Qualification fiscale : un véhicule ou un meuble est exonéré par nature
  -- (art. 150 UA II 1°) sauf s'il est objet de collection. Le drapeau ne se
  -- déduit pas de la catégorie, il doit être déclaré.
  ADD COLUMN "isCollectible" BOOLEAN NOT NULL DEFAULT false,

  -- Pierres (JEWELRY / GEMSTONE)
  ADD COLUMN "gemType"      TEXT,
  ADD COLUMN "caratWeight"  DECIMAL(12,4),
  ADD COLUMN "gemClarity"   TEXT,
  ADD COLUMN "gemColor"     TEXT,
  ADD COLUMN "gemCut"       TEXT,
  ADD COLUMN "gemTreatment" TEXT,
  ADD COLUMN "gemOrigin"    TEXT,

  -- Bijoux
  ADD COLUMN "jewelryType"   TEXT,
  ADD COLUMN "metalBase"     TEXT,
  ADD COLUMN "metalWeightG"  DECIMAL(12,4),
  ADD COLUMN "hasPunchmarks" BOOLEAN,

  -- Horlogerie
  ADD COLUMN "watchMovement"   TEXT,
  ADD COLUMN "watchDiameterMm" DECIMAL(8,2),
  ADD COLUMN "watchReference"  TEXT,
  ADD COLUMN "watchBoxPapers"  BOOLEAN,

  -- Vins & spiritueux
  ADD COLUMN "wineAppellation"  TEXT,
  ADD COLUMN "wineBottleCount"  INTEGER,
  ADD COLUMN "wineBottleFormat" TEXT,
  ADD COLUMN "wineStorageType"  TEXT,

  -- Automobiles
  ADD COLUMN "autoMileageKm"      INTEGER,
  ADD COLUMN "autoRegistration"   TEXT,
  ADD COLUMN "autoInspectionOk"   BOOLEAN,
  ADD COLUMN "autoPreviousOwners" INTEGER;

-- Une collection se filtre d'abord par date d'acquisition (durée de détention)
-- et par nature fiscale : les deux requêtes que l'écran fait à chaque rendu.
CREATE INDEX "TangibleAsset_userId_purchaseDate_idx"
  ON "TangibleAsset"("userId", "purchaseDate");
CREATE INDEX "TangibleAsset_userId_isCollectible_idx"
  ON "TangibleAsset"("userId", "isCollectible");
