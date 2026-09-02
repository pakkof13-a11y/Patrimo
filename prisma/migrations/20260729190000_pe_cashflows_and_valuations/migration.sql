-- Private Equity : cash-flows (commitment/appelé/distributions) et
-- historique de valorisation.
--
-- Migration additive uniquement — toutes les colonnes ajoutées à
-- PrivateEquityPosition ont un default, aucune ligne existante n'est
-- réécrite. En particulier, `calledCapital` n'est PAS recalculé à partir de
-- shares × acquisitionPricePerShare pour les lignes existantes : il démarre
-- à 0, à charge de saisie côté application. L'écraser silencieusement avec
-- une valeur déduite aurait pu masquer un appel de capital partiel déjà
-- réel mais non encore enregistré comme tel.

ALTER TABLE "PrivateEquityPosition"
  ADD COLUMN "committedCapital"      DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "calledCapital"         DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "distributionsReceived" DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "ownershipPercent"      DECIMAL(10,6),
  ADD COLUMN "expectedExitDate"      TIMESTAMP(3),
  ADD COLUMN "vehicleName"           TEXT,
  ADD COLUMN "round"                 TEXT;

-- Historique de valorisation : une ligne par NAV connue dans le temps.
-- `currentNav` sur PrivateEquityPosition reste le dernier point pour un
-- accès direct sans jointure ; cette table porte la série complète.
CREATE TABLE "PrivateEquityValuation" (
  "id"                      TEXT NOT NULL,
  "privateEquityPositionId" TEXT NOT NULL,
  "nav"                     DECIMAL(28,12) NOT NULL,
  "note"                    TEXT,
  "valuedAt"                TIMESTAMP(3) NOT NULL,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivateEquityValuation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivateEquityValuation_privateEquityPositionId_valuedAt_idx"
  ON "PrivateEquityValuation"("privateEquityPositionId", "valuedAt");

-- Cascade : un historique de valorisation n'a aucun sens sans sa ligne.
ALTER TABLE "PrivateEquityValuation"
  ADD CONSTRAINT "PrivateEquityValuation_privateEquityPositionId_fkey"
  FOREIGN KEY ("privateEquityPositionId") REFERENCES "PrivateEquityPosition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
