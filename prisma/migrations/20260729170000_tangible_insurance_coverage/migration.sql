-- Tangibles : couverture d'assurance.
--
-- Migration additive. Trois notions manquaient pour juger d'une couverture,
-- au-delà du montant assuré et de la prime déjà en place :
--
--  * `insuranceExpiryDate` — une police échue ne couvre rien, et l'échéance
--    d'une police n'a rien à voir avec celle du contrat de garde ;
--  * `insuranceType` — une multirisque habitation plafonne les objets de
--    valeur à quelques milliers d'euros, là où un contrat objets d'art couvre
--    la valeur agréée. Le capital saisi ne dit donc pas seul ce qui est
--    réellement garanti ;
--  * `appraisalProvider` — la valeur d'expertise n'a pas le même poids selon
--    qu'elle vient d'un notaire, de l'assureur lui-même ou d'un expert
--    indépendant.

ALTER TABLE "TangibleAsset"
  ADD COLUMN "insuranceExpiryDate" TIMESTAMP(3),
  ADD COLUMN "insuranceType"       TEXT,
  ADD COLUMN "appraisalProvider"   TEXT;

-- Les polices se relisent par ordre d'échéance, comme les contrats de garde.
CREATE INDEX "TangibleAsset_userId_insuranceExpiryDate_idx"
  ON "TangibleAsset"("userId", "insuranceExpiryDate");
