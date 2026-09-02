-- Retrait du palier de repli ADEME (décision produit : DVF seul).
--
-- La table n'a jamais été peuplée (aucun import fourni) : la suppression ne
-- perd aucune donnée. `RealEstateDetail.dvfSource` est conservée — elle ne
-- prendra simplement plus la valeur "ADEME_COMMUNE_DPE".

DROP TABLE "AdemeCommuneDpeMedian";
