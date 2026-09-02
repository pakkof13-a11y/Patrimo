-- Passifs : catégorie (IMMOBILIER | AUTO | CONSOMMATION | DETTE_PRIVEE |
-- PROFESSIONNEL | AUTRE).
--
-- Migration additive uniquement — colonne avec default, aucune ligne
-- existante n'est réécrite : tout crédit déjà saisi se retrouve classé
-- "AUTRE" jusqu'à correction manuelle, sans backfill de correspondance
-- (le nom du crédit ne suffit pas à déduire sa catégorie de façon fiable).

ALTER TABLE "Liability"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'AUTRE';
