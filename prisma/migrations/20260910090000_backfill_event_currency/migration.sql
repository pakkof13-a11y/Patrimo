-- Reprise de la devise des événements déjà en base.
--
-- Les deux migrations précédentes ont ajouté `currency TEXT NOT NULL DEFAULT
-- 'EUR'` sur BankAccountEvent et SavingsAccountEvent, sans reprise. Toute ligne
-- antérieure a donc pris 'EUR', quelle que soit la devise de son compte.
--
-- Ce n'est pas une question d'étiquette : `app/lib/portfolio/historical/load.ts`
-- convertit désormais chaque mouvement avec `e.currency`. Sur un compte en
-- dollars, tout l'historique d'avant ce déploiement était donc valorisé comme
-- des euros — la courbe de NAV fausse du rapport de change sur toute la période.
--
-- Avant l'ajout de la colonne, le chargeur utilisait la devise *courante* du
-- compte : exacte pour tout compte qui n'a jamais changé de devise, c'est-à-dire
-- l'immense majorité. La colonne a donc échangé un cas rare et faux (après un
-- changement de devise) contre un cas courant et faux (tout compte non-euro).
-- Cette reprise rétablit le premier état pour ces comptes-là.
--
-- ── Ce que la reprise ne fait pas, et pourquoi ──────────────────────────────
--
-- Elle ne touche **aucun** compte portant déjà un événement REDENOMINATION.
--
-- Le garde évident — « ne pas écraser les événements postérieurs à ce point » —
-- ne suffit pas : sur un compte passé de l'euro au dollar, les événements
-- *antérieurs* au changement sont en euros, et `a.currency` vaut désormais USD.
-- Les reprendre depuis le compte les casserait exactement comme le défaut qu'on
-- répare. Leur vraie devise n'est nulle part en base sous forme exploitable —
-- seulement dans le libellé « EUR → USD » du REDENOMINATION, que cette
-- migration ne va pas se mettre à analyser.
--
-- Ces comptes gardent donc leur état actuel : 'EUR' sur les lignes d'avant la
-- colonne, ce qui est juste si elles étaient bien en euros, et faux sinon. Un
-- résidu assumé, et vide en pratique : REDENOMINATION n'existe que depuis D39,
-- dont les migrations n'ont pas encore été appliquées.

UPDATE "BankAccountEvent" e
SET currency = a.currency
FROM "BankAccount" a
WHERE e."bankAccountId" = a.id
  AND NOT EXISTS (
    SELECT 1
    FROM "BankAccountEvent" r
    WHERE r."bankAccountId" = e."bankAccountId"
      AND r.type = 'REDENOMINATION'
  );

UPDATE "SavingsAccountEvent" e
SET currency = a.currency
FROM "SavingsAccount" a
WHERE e."savingsAccountId" = a.id
  AND NOT EXISTS (
    SELECT 1
    FROM "SavingsAccountEvent" r
    WHERE r."savingsAccountId" = e."savingsAccountId"
      AND r.type = 'REDENOMINATION'
  );
