-- Collecte des données manquantes pour la fiscalité des rachats d'assurance-vie
-- (étape 1) : répartition des versements avant / après le 27/09/2017, et
-- situation fiscale du foyer (abattement 4 600 € / 9 200 €).
--
-- L'encours total tous contrats n'est pas stocké : il se calcule en sommant les
-- contrats existants. Le moteur de calcul d'imposition n'est pas dans cette
-- migration.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "taxHousehold" TEXT NOT NULL DEFAULT 'SINGLE';

ALTER TABLE "LifeInsurance" ADD COLUMN IF NOT EXISTS "premiumsBefore2017Eur" DECIMAL(28,12) NOT NULL DEFAULT 0;
ALTER TABLE "LifeInsurance" ADD COLUMN IF NOT EXISTS "premiumsAfter2017Eur" DECIMAL(28,12) NOT NULL DEFAULT 0;
