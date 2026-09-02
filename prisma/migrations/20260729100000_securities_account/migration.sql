-- CreateTable: compte titres chez un courtier (PEA / PEA-PME / CTO)
CREATE TABLE "SecuritiesAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "envelopeType" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "openDate" TIMESTAMP(3) NOT NULL,
  "iban" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecuritiesAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecuritiesAccount_userId_idx" ON "SecuritiesAccount"("userId");
CREATE INDEX "SecuritiesAccount_userId_envelopeType_idx" ON "SecuritiesAccount"("userId", "envelopeType");
CREATE INDEX "SecuritiesAccount_platformId_idx" ON "SecuritiesAccount"("platformId");

-- Un PEA et un PEA-PME au maximum par personne : c'est la loi, pas une règle
-- applicative. Index **partiel** plutôt que `@@unique([userId, envelopeType])`
-- complet, qui interdirait du même coup le second CTO — or détenir plusieurs
-- comptes-titres ordinaires chez plusieurs courtiers est parfaitement légal et
-- courant. Prisma ne sait pas déclarer un index partiel dans le schéma : il
-- vit donc ici, et le service lève l'erreur lisible avant qu'on y arrive.
CREATE UNIQUE INDEX "SecuritiesAccount_userId_unique_pea"
  ON "SecuritiesAccount"("userId", "envelopeType")
  WHERE "envelopeType" IN ('PEA', 'PEA_PME');

ALTER TABLE "SecuritiesAccount"
  ADD CONSTRAINT "SecuritiesAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict : supprimer un courtier encore teneur d'un compte doit échouer
-- plutôt que d'orpheliner le compte — même choix que `Asset.platformId`.
ALTER TABLE "SecuritiesAccount"
  ADD CONSTRAINT "SecuritiesAccount_platformId_fkey"
  FOREIGN KEY ("platformId") REFERENCES "Platform"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: rattachement d'une ligne de titres à l'un des comptes de son
-- enveloppe. Nullable — aucun actif existant n'est affecté, et `accountType`
-- continue seul à porter l'enveloppe fiscale tant que la ligne n'est pas
-- rattachée.
ALTER TABLE "Asset" ADD COLUMN "securitiesAccountId" TEXT;

CREATE INDEX "Asset_securitiesAccountId_idx" ON "Asset"("securitiesAccountId");

-- SetNull : supprimer un compte ne supprime jamais les titres qu'il détenait,
-- il les détache. Leur journal — donc leur valorisation et leur prix de
-- revient — est intact.
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_securitiesAccountId_fkey"
  FOREIGN KEY ("securitiesAccountId") REFERENCES "SecuritiesAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
