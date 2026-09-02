-- Paramètres de calcul des dispositifs de défiscalisation.
--
-- La base légale (prix de revient plafonné, ou montant de travaux en Malraux)
-- ne se déduit pas du journal : le coût de revient comptable inclut les frais
-- d'acquisition, que l'assiette du dispositif exclut. D'où un champ dédié.
ALTER TABLE "RealEstateDetail"
  ADD COLUMN "schemeStartYear" INTEGER,
  ADD COLUMN "schemeCommitmentYears" INTEGER,
  ADD COLUMN "schemeBaseEur" DECIMAL(14,2),
  ADD COLUMN "schemeRatePct" DECIMAL(6,3);
