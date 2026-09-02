-- Tranche marginale d'imposition du foyer.
--
-- Portée par l'utilisateur et non par un bien : un foyer a une tranche, pas un
-- appartement. Même emplacement que `taxHousehold`, qui relève du même
-- raisonnement.
--
-- Nullable : « non renseigné » doit rester distinguable de « 30 % », qui n'est
-- qu'un défaut de calcul. Aucune valeur n'est rétro-attribuée pour cette raison.
ALTER TABLE "User" ADD COLUMN "marginalTaxRatePct" INTEGER;
