-- Épargne salariale : montant versé et famille de support.
--
-- Deux colonnes nullables, purement additives : aucune ligne existante n'est
-- touchée, et l'écran distingue « non renseigné » de « zéro ».
ALTER TABLE "EmployeeSavingsLine" ADD COLUMN "contributedAmount" DECIMAL(28,12);
ALTER TABLE "EmployeeSavingsLine" ADD COLUMN "fundCategory" TEXT;
