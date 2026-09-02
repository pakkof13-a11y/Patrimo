-- Réconciliation de l'historique de migrations avec `schema.prisma`.
--
-- L'historique et le schéma avaient divergé : rejouer les 54 migrations sur une
-- base vierge ne produisait plus la forme décrite par `schema.prisma`. Deux
-- conséquences, l'une gênante et l'autre sérieuse :
--
--   * `prisma migrate dev` proposait systématiquement de réinitialiser la base
--     de développement, ce qui rend impossible la création d'une migration
--     sans détruire ses données ;
--   * surtout, toute base **neuve** — première mise en production, intégration
--     continue, poste d'un collègue — atterrissait sur une forme différente de
--     celle sur laquelle l'application tourne : une colonne fantôme, quatre
--     index morts, un index utile manquant, et trois valeurs par défaut que le
--     client Prisma ne connaît pas.
--
-- Cette migration rejoue exactement l'écart calculé par `prisma migrate diff`.
-- Elle est écrite en `IF EXISTS` / `IF NOT EXISTS` : sur une base déjà
-- conforme — celle de développement, la production si elle a été alignée à la
-- main — elle ne fait rien.

-- ── Colonne retirée du schéma mais toujours créée par l'historique ──────────
-- `Liability.platformId` n'existe plus dans `schema.prisma` ; le client Prisma
-- ne sait donc ni la lire ni l'écrire. La conserver ne protégerait aucune
-- donnée accessible : elle serait invisible depuis l'application.
ALTER TABLE "Liability" DROP CONSTRAINT IF EXISTS "Liability_platformId_fkey";
ALTER TABLE "Liability" DROP COLUMN IF EXISTS "platformId";

-- ── Index que le schéma ne déclare plus ─────────────────────────────────────
DROP INDEX IF EXISTS "Asset_countryCode_idx";
DROP INDEX IF EXISTS "TangibleAsset_userId_insuranceExpiryDate_idx";
DROP INDEX IF EXISTS "TangibleAsset_userId_isCollectible_idx";
DROP INDEX IF EXISTS "TangibleAsset_userId_purchaseDate_idx";
DROP INDEX IF EXISTS "TangibleAsset_userId_storageRenewalDate_idx";

-- ── Index déclaré par le schéma mais absent de l'historique ─────────────────
-- Celui-ci n'est pas cosmétique : le filtrage des positions par enveloppe le
-- traverse à chaque affichage du portefeuille.
CREATE INDEX IF NOT EXISTS "Asset_userId_accountType_idx"
  ON "Asset"("userId", "accountType");

-- ── Valeurs par défaut que le schéma ne porte pas ───────────────────────────
-- `@updatedAt` est géré par le client, qui écrit l'horodatage à chaque mise à
-- jour. Un `DEFAULT` côté base ne sert qu'à l'insertion et masque, en cas
-- d'écriture SQL directe, l'absence de valeur applicative.
ALTER TABLE "LifeInsuranceSupport" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "RealEstateDetail" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Transaction" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "PriceQuote" ALTER COLUMN "priceNative" DROP DEFAULT;

-- ── Index renommé par une migration ultérieure ──────────────────────────────
-- Le nom long avait été tronqué par Postgres à la création ; le schéma retient
-- le nom abrégé de Prisma.
ALTER INDEX IF EXISTS "SecuritiesAccountContribution_securitiesAccountId_occurredAt_id"
  RENAME TO "SecuritiesAccountContribution_securitiesAccountId_occurredA_idx";
