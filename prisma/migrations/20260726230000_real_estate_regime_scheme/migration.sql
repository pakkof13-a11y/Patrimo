-- Régime fiscal et dispositif de défiscalisation, portés par le bien.
--
-- Trois dimensions distinctes plutôt qu'un enum d'usage fourre-tout :
-- l'usage dit ce qu'on fait du bien, le régime comment les revenus sont
-- imposés, le dispositif quelle réduction d'impôt s'y ajoute. Un Pinel est
-- un locatif nu au foncier avec un engagement de durée — trois valeurs.
ALTER TABLE "RealEstateDetail"
  ADD COLUMN "rentalRegime" TEXT,
  ADD COLUMN "taxScheme" TEXT,
  ADD COLUMN "commitmentEndDate" TIMESTAMP(3),
  ADD COLUMN "isClassifiedTourism" BOOLEAN NOT NULL DEFAULT false;
