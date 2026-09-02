-- CreateTable: versements et retraits déclarés sur un compte titres.
--
-- Le montant cumulé des versements conditionne le plafond légal du PEA. Il ne
-- peut pas se déduire du journal : un `APPORT` y est un dépôt de liquidité
-- bancaire rattaché à une plateforme, sans notion d'enveloppe, et un même
-- courtier héberge couramment un PEA et un CTO. Un journal dédié, plutôt qu'un
-- total modifiable en place, garde le chiffre auditable — sans quoi un
-- dépassement de plafond serait inexplicable.
CREATE TABLE "SecuritiesAccountContribution" (
  "id" TEXT NOT NULL,
  "securitiesAccountId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountEur" DECIMAL(28,12) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecuritiesAccountContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecuritiesAccountContribution_securitiesAccountId_occurredAt_idx"
  ON "SecuritiesAccountContribution"("securitiesAccountId", "occurredAt");

-- Cascade : l'historique de versement n'a aucun sens sans son compte,
-- contrairement aux titres, qui sont détachés et conservent leur journal.
ALTER TABLE "SecuritiesAccountContribution"
  ADD CONSTRAINT "SecuritiesAccountContribution_securitiesAccountId_fkey"
  FOREIGN KEY ("securitiesAccountId") REFERENCES "SecuritiesAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
