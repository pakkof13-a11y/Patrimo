-- Tangibles : justificatif d'achat et frais d'acquisition.
--
-- `hasCertificate` servait jusqu'ici de preuve d'acquisition faute de mieux.
-- C'est un raccourci faux : un certificat GIA atteste qu'une pierre est un
-- saphir naturel de 2,5 carats, il ne dit ni son prix ni sa date d'achat. Or
-- l'option pour le régime réel (art. 150 VL) exige précisément ces deux
-- éléments. Les objets certifiés mais sans facture se voyaient donc ouvrir
-- une option qui leur est fermée, et l'impôt annoncé était sous-évalué.
--
-- Les frais d'acquisition entrent dans le prix de revient : les omettre
-- gonflait la plus-value taxable au régime réel.

ALTER TABLE "TangibleAsset"
  ADD COLUMN "hasPurchaseProof" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "acquisitionFees"  DECIMAL(28,12);

-- Reprise de l'existant : là où un certificat était déclaré **et** une date
-- d'achat connue, la ligne bénéficiait déjà de l'option. La retirer d'office
-- ferait apparaître un impôt nouveau sur des objets inchangés ; on conserve
-- donc l'état effectif, à charge pour l'utilisateur de décocher ce qu'il ne
-- peut pas justifier. Le formulaire distingue désormais les deux notions.
UPDATE "TangibleAsset"
   SET "hasPurchaseProof" = true
 WHERE "hasCertificate" = true
   AND "purchaseDate" IS NOT NULL;
