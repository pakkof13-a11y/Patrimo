-- `DefiSyncCursor` : unicité réelle de la portée d'un curseur.
--
-- La contrainte posée par la migration précédente portait sur
-- (userId, provider, platformId, sourceRef), deux colonnes nullables.
-- PostgreSQL ne fait pas collisionner deux NULL dans un index unique : elle
-- laissait donc créer autant de curseurs « sans plateforme » qu'on voulait,
-- exactement le doublon qu'elle prétendait interdire — et deux syncs
-- concurrentes se seraient volé leur position de lecture.
--
-- `scopeKey` porte la portée sous une forme jamais nulle (cf. `syncScopeKey()`),
-- ce qui rend l'unicité effective. La table vient d'être créée et est vide :
-- l'ajout d'une colonne NOT NULL sans défaut ne peut échouer sur aucune ligne.

ALTER TABLE "DefiSyncCursor" ADD COLUMN "scopeKey" TEXT NOT NULL;

DROP INDEX "DefiSyncCursor_userId_provider_platformId_sourceRef_key";

CREATE UNIQUE INDEX "DefiSyncCursor_userId_provider_scopeKey_key" ON "DefiSyncCursor"("userId", "provider", "scopeKey");
