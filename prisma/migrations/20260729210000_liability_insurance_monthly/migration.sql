-- Passifs : assurance emprunteur mensuelle.
--
-- Migration additive uniquement — colonne nullable, aucun default à
-- appliquer et aucune ligne existante n'est réécrite : null est traité
-- comme 0 partout côté application (tableau d'amortissement, saisie,
-- affichage), donc laisser la colonne vide sur les crédits existants ne
-- change rien à leur comportement actuel.

ALTER TABLE "Liability"
  ADD COLUMN "insuranceMonthly" DECIMAL(28,12);
