-- Tangibles : assurance, garde et transmission.
--
-- Migration additive. Deux notions volontairement séparées côté assurance :
-- `insuranceValue` est le capital garanti, `insurancePremiumAnnual` la prime
-- payée. Les confondre reviendrait à compter une couverture comme un coût.
--
-- `storageType` conditionne l'alerte la plus utile du module : un objet de
-- forte valeur conservé au domicile et non assuré.

ALTER TABLE "TangibleAsset"
  -- Assurance
  ADD COLUMN "insurancePremiumAnnual" DECIMAL(28,12),
  ADD COLUMN "insuranceProvider"      TEXT,
  ADD COLUMN "insurancePolicyRef"     TEXT,

  -- Garde / conservation
  ADD COLUMN "storageType"        TEXT,
  ADD COLUMN "storageCostAnnual"  DECIMAL(28,12),
  ADD COLUMN "storageProvider"    TEXT,
  ADD COLUMN "storageContractRef" TEXT,
  ADD COLUMN "storageRenewalDate" TIMESTAMP(3),

  -- Transmission : marqueur seul, aucun barème de droits n'est calculé ici.
  ADD COLUMN "includeInEstate" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "estateNote"      TEXT;

-- Les échéances de contrat de garde se lisent par ordre de proximité : c'est
-- la seule requête temporelle du module.
CREATE INDEX "TangibleAsset_userId_storageRenewalDate_idx"
  ON "TangibleAsset"("userId", "storageRenewalDate");
