-- Métaux précieux : la ligne devient un lot daté, et la cession devient un objet.
--
-- Sans date d'acquisition, l'abattement pour durée de détention de l'article
-- 150 VI CGI est incalculable et l'option pour le régime réel (2092-SD) est
-- fermée : c'est la colonne qui débloque toute la fiscalité du module.

ALTER TABLE "PreciousMetalPosition"
  ADD COLUMN "metal"           TEXT NOT NULL DEFAULT 'GOLD',
  ADD COLUMN "productType"     TEXT NOT NULL DEFAULT 'COIN',
  ADD COLUMN "fineness"        DECIMAL(6,2) NOT NULL DEFAULT 999,
  ADD COLUMN "acquisitionFees" DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "acquiredAt"      TIMESTAMP(3),
  ADD COLUMN "hasInvoice"      BOOLEAN NOT NULL DEFAULT false;

-- assetKind ne distinguait que « métal » et « autre » : trop pauvre pour
-- agréger un poids fin. Les lignes marquées OTHER ne sont pas des métaux et
-- gardent cette qualité ; les autres deviennent de l'or, choix par défaut le
-- plus probable, rectifiable en un clic dans le formulaire.
UPDATE "PreciousMetalPosition" SET "metal" = 'OTHER' WHERE "assetKind" = 'OTHER';

-- Le poids ne pouvait être qu'en métal fin pur faute de titre : on part de
-- 999 par défaut, sauf pour le papier où le titre n'a pas de sens.
UPDATE "PreciousMetalPosition" SET "productType" = 'ETC' WHERE "format" = 'PAPER';

DROP INDEX IF EXISTS "PreciousMetalPosition_userId_assetKind_idx";
ALTER TABLE "PreciousMetalPosition" DROP COLUMN "assetKind";
CREATE INDEX "PreciousMetalPosition_userId_metal_idx"
  ON "PreciousMetalPosition"("userId", "metal");

-- La cession est le fait générateur de l'impôt : la détention, elle, n'est
-- jamais taxée. On la stocke pour rejouer l'année fiscale, jamais l'impôt
-- lui-même, qui reste recalculé.
CREATE TABLE "PreciousMetalSale" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "positionId"   TEXT,
  "denomination" TEXT NOT NULL,
  "quantity"     DECIMAL(28,12) NOT NULL DEFAULT 0,
  "salePriceEur" DECIMAL(28,12) NOT NULL DEFAULT 0,
  "saleFeesEur"  DECIMAL(28,12) NOT NULL DEFAULT 0,
  "costBasisEur" DECIMAL(28,12) NOT NULL DEFAULT 0,
  "soldAt"       TIMESTAMP(3) NOT NULL,
  "acquiredAt"   TIMESTAMP(3),
  "regime"       TEXT NOT NULL DEFAULT 'FORFAIT',
  "hasInvoice"   BOOLEAN NOT NULL DEFAULT false,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PreciousMetalSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PreciousMetalSale_userId_idx" ON "PreciousMetalSale"("userId");
CREATE INDEX "PreciousMetalSale_userId_soldAt_idx" ON "PreciousMetalSale"("userId", "soldAt");
CREATE INDEX "PreciousMetalSale_positionId_idx" ON "PreciousMetalSale"("positionId");

ALTER TABLE "PreciousMetalSale"
  ADD CONSTRAINT "PreciousMetalSale_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supprimer un lot ne doit pas effacer l'historique fiscal qu'il a produit :
-- la vente survit, détachée.
ALTER TABLE "PreciousMetalSale"
  ADD CONSTRAINT "PreciousMetalSale_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "PreciousMetalPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
