# audit-auth — Session, IDOR, wipe, cron GET+secret

```
ID:             AUTH-01
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/clear-user-data.ts:120 ; prisma/migrations/20260729100000_securities_account/migration.sql:37-39
Reproduction:   1. Utilisateur avec au moins un compte-titres (POST /api/securities/accounts, rattaché à une plateforme). 2. DELETE /api/preferences/clear-data. 3. `tx.platform.deleteMany({where:{userId}})` heurte la FK `SecuritiesAccount.platformId` en ON DELETE RESTRICT → P2003. 4. Le $transaction entier est annulé → 500, aucune donnée supprimée.
Effet:          Le wipe de compte est inopérant pour tout utilisateur possédant un compte-titres. (Constaté par lecture du code et du SQL de migration — non exécuté, aucune écriture autorisée.)
Déjà connu:     non

ID:             AUTH-02
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/clear-user-data.ts:27-137 ; schema.prisma:950 (TermDeposit), :1237 (PreciousMetalSale, position en SetNull), :2325 (DefiMarketRef), :1660 (SecuritiesAccount + Contribution)
Reproduction:   1. Utilisateur sans compte-titres (pour éviter AUTH-01) mais avec un dépôt à terme, une vente de métal précieux, ou des refs de marché DeFi. 2. DELETE /api/preferences/clear-data → 200, "toutes les saisies ont été effacées". 3. GET /api/term-deposits, GET /api/precious-metals/sales → les lignes sont toujours là.
Effet:          Données financières résiduelles après un wipe annoncé complet : dépôts à terme, historique de ventes de métaux, refs DeFi. Le résultat retourné ne compte aucun de ces modèles, l'oubli est silencieux.
Déjà connu:     non (docs/nft-backend-v1.md:231 documente le même type d'oubli pour NFT/DeFi, corrigé ; ces 4 modèles n'y figurent pas)

ID:             AUTH-03
Gravité:        P2
Fichier:ligne:  auth.ts:48 (JWT 30j), auth.ts:177-187 (callback jwt sans claim de version) ; app/api/auth/change-password/route.ts:50-53 ; app/api/admin/users/route.ts:117-123 ; app/lib/auth-helpers.ts:157-163
Reproduction:   1. Session A ouverte (cookie JWT). 2. Depuis une autre session, POST /api/auth/change-password (ou admin PATCH /api/admin/users) — seul passwordHash mis à jour ; invalidateUserAccessCache ne purge que le cache rôle/existence. 3. Rejouer une requête avec le cookie de la session A → toujours 200, jusqu'à 30 jours.
Effet:          Un cookie de session volé reste valide après réinitialisation du mot de passe. Seul mécanisme de révocation existant : rotation globale d'AUTH_SECRET (déconnecte tout le monde). Arbitrage produit à remonter (versionner le JWT ou passwordChangedAt vs iat).
Déjà connu:     non
```
