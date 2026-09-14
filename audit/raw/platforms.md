# audit-platforms — DELETE vs inventaire, wipe autocomplete

```
ID:             PLA-01
Gravité:        P1
Fichier:ligne:  app/lib/portfolio/clear-user-data.ts:120
Reproduction:   Plateforme "Boursorama" + compte-titres PEA dessus. Préférences > "Effacer mon patrimoine" > confirmer > DELETE /api/preferences/clear-data. resetUserData ne supprime jamais securitiesAccount ; platform.deleteMany heurte SecuritiesAccount RESTRICT → P2003 → rollback total.
Effet:          Wipe impossible (500) pour tout utilisateur ayant ≥1 compte-titres PEA/PEA-PME/CTO. 0 ligne effacée. Aucun test ne couvre ce cas. [NON MESURÉ en base]
Déjà connu:     non — DOUBLON de AUTH-01 (même fichier:ligne, même effet), à fusionner en compilation

ID:             PLA-02
Gravité:        P2
Fichier:ligne:  app/api/preferences/clear-data/route.ts:13-25 (`void req;`)
Reproduction:   Session valide, fetch DELETE /api/preferences/clear-data depuis la console — sans case cochée, sans mot SUPPRIMER, sans corps.
Effet:          La confirmation "SUPPRIMER" n'existe qu'en client ; le serveur efface l'intégralité du patrimoine sur une simple requête DELETE non qualifiée. Aucun jeton/mot de confirmation vérifié côté API. Vecteur CSRF non évalué. [NON MESURÉ]
Déjà connu:     non

ID:             PLA-03
Gravité:        P2
Fichier:ligne:  app/lib/platforms/upsert.ts:184-197 (mergePlatforms)
Reproduction:   Plateforme A avec compte-titres CTO, plateforme B. POST merge {sourceId:A,targetId:B}. Seuls asset et transaction déplacés ; tx.platform.delete(A) heurte Restrict.
Effet:          Fusion refusée en 500 sans indication de cause. Variante : si A porte des BlockchainOnchainTx (Cascade) ou DefiSyncCursor/NftSyncCursor (Cascade), ils sont détruits silencieusement au lieu d'être réaffectés à B. [NON MESURÉ]
Déjà connu:     non — recoupe PRI-01, à fusionner

ID:             PLA-04
Gravité:        P2
Fichier:ligne:  app/api/platforms/route.ts:390-394 ; account-service.ts:295-313 (setAssetAccount)
Reproduction:   Compte-titres CTO sur plateforme A ; actif X platformId=B (setAssetAccount ne vérifie que l'enveloppe). Rattacher X au compte de A. Supprimer A (force). SecuritiesAccount.deleteMany → Asset.securitiesAccountId SetNull sur X.
Effet:          X survit sur B mais perd son compte-titres sans AssetEnvelopeEvent "CHANGED" — alors que deleteAccount journalise précisément ce détachement. Le journal d'enveloppe diverge de l'état courant ; l'inventaire d'impact ne mentionne ni comptes-titres ni versements détachés. Distinct de JOU-03. [NON MESURÉ]
Déjà connu:     non

ID:             PLA-05
Gravité:        P3
Fichier:ligne:  app/api/platforms/route.ts:317-329,421
Reproduction:   Plateforme A : 0 actif, 0 transaction, 1 compte-titres (ou N BlockchainOnchainTx). DELETE sans force.
Effet:          Le garde ne compte que actifs/transactions → passe ; deleteMany échoue en P2003 → 500 "Réessayez avec force", qui suggère la destruction du compte-titres comme remède. Cas on-chain : les BlockchainOnchainTx cascadent silencieusement sans figurer dans le 409. [NON MESURÉ]
Déjà connu:     non
```
