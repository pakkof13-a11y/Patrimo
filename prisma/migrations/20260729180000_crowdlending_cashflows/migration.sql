-- Crowdlending : suivi des cash-flows par ligne.
--
-- Migration additive uniquement — toutes les colonnes ont un default,
-- aucune ligne existante n'est réécrite.
--
-- `remainingCapital` distingue le capital investi du capital restant dû :
-- sur un remboursement amortissable, les deux divergent dès la première
-- échéance. `interestReceivedToDate` cumule les intérêts déjà perçus, pour
-- distinguer le rendement réalisé du rendement théorique affiché par
-- `annualYieldPercent`.

ALTER TABLE "CrowdlendingPosition"
  ADD COLUMN "remainingCapital"       DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "interestReceivedToDate" DECIMAL(28,12) NOT NULL DEFAULT 0,
  ADD COLUMN "paymentFrequency"       TEXT NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "nextPaymentDate"        TIMESTAMP(3),
  ADD COLUMN "riskGrade"              TEXT;
