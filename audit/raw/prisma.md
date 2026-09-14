# audit-prisma — Restrict, tx 5s, seed

```
ID:             PRI-01
Gravité:        P2
Fichier:ligne:  app/lib/platforms/upsert.ts:184-197 (mergePlatforms) ; app/api/platforms/merge/route.ts:39-44
Reproduction:   POST /api/platforms/merge {sourceId:<plateforme avec ≥1 SecuritiesAccount>, targetId}. La tx déplace Asset+Transaction puis tx.platform.delete(source) ; SecuritiesAccount.platformId RESTRICT (vérifié en base) → P2003, rollback, 500. Base actuelle : "Interactive Brokers" = 2 SecuritiesAccount → fusion impossible.
Effet:          Chemin de fusion bloqué pour toute plateforme teneuse de compte-titres, sans message actionnable. Bonus non traité : DefiSyncCursor/NftSyncCursor/BlockchainOnchainTx en Cascade sur la source → perdus silencieusement à la fusion d'un wallet. [NON MESURÉ]
Déjà connu:     non (AUTH-01=clear-user-data, JOU-04=DELETE user admin)

ID:             PRI-02
Gravité:        P2
Fichier:ligne:  app/api/platforms/route.ts:270-277 (comptage dépendances) ; :421 (delete sans force) ; :390 (force)
Reproduction:   SecuritiesAccount sur plateforme neuve (0 Asset, 0 Transaction). DELETE sans force. assetCount=0,txCount=0 → pas de 409 → deleteMany → RESTRICT → catch → 500.
Effet:          Le contrat 409 HAS_DEPENDENCIES ne recense pas les comptes-titres ; en force=1 ils sont supprimés (contributions en Cascade) sans que le payload de confirmation ne les ait annoncés.
Déjà connu:     non

ID:             PRI-03
Gravité:        P2
Fichier:ligne:  app/api/life-insurance/route.ts:283 ; schema.prisma:1077 (LifeInsuranceSupport.lifeInsurance SetNull)
Reproduction:   DELETE contrat AV. lifeInsurance.deleteMany sans contrôle des supports ; SetNull détache les LifeInsuranceSupport, les Asset accountType=AV et leur journal restent. Mesuré en base : "Fonds euro Linxea" 29957,5594 parts × 1,02 = 30556,71€ + fonds MSCI World restent valorisés après suppression.
Effet:          Le patrimoine net ne bouge pas quand un contrat est supprimé ; les supports réapparaissent "sans contrat rattaché". Aucune des 3 politiques (Cascade/Restrict/cascade manuelle) n'est appliquée au niveau contrat.
Déjà connu:     non

ID:             PRI-04
Gravité:        P2
Fichier:ligne:  app/lib/liabilities/service.ts:149-162 (materialiser) ; amortization.ts:150 (cap 600)
Reproduction:   Dette lastPaymentAppliedAt=null, startDate ancienne → jusqu'à 600 échéances, tx interactive (budget défaut 5s, sans timeout) exécute N créations séquentielles. RTT Neon mesuré 32-44ms/requête → 130 events≈5s, 600≈23s. Base actuelle : "Crédit immo Lyon" (60 events, ≈2,3s local), "Crédit conso auto" (23).
Effet:          Au-delà du budget, P2028 remonte → recordEarlyRepayment échoue, rien n'est écrit : remboursement anticipé impossible sur un prêt long jamais matérialisé.
Déjà connu:     non (PAS-01..05 portent sur les valeurs remainingAfter, pas sur le budget de transaction)

ID:             PRI-05
Gravité:        P3
Fichier:ligne:  app/lib/market/triggers.ts:232-318 ; transactions/service.ts:482-486
Reproduction:   Tx Serializable (5s défaut) : par fill×plateforme, createTransaction refait un findMany du journal ENTIER + replay complet, jusqu'à 5 niveaux × k plateformes dans la même tx. Base actuelle : 492 tx, 2 actifs avec SL+TP1. [NON MESURÉ]
Effet:          Sur un journal volumineux, dépassement possible du budget → fill perdu, niveaux non effacés → re-déclenchement au refresh suivant, jamais exécuté.
Déjà connu:     non

ID:             PRI-06
Gravité:        P3
Fichier:ligne:  app/lib/portfolio/clear-user-data.ts:31 (aucune option timeout)
Reproduction:   DELETE clear-data sur compte démo : la tx (5s) supprime 492 Transaction, 31 Asset, cascade 65506 AssetDailyClose (table 22MB) + 4446 PriceHistory + 2439 AssetIntradayBar. La même opération côté plateforme s'octroie explicitement 60s. [NON MESURÉ]
Effet:          Au-delà du budget : P2028, rien n'est supprimé, 500 générique (sur la base actuelle, échoue déjà avant par AUTH-01 — constat distinct : budget, pas RESTRICT).
Déjà connu:     non

ID:             PRI-07
Gravité:        P3
Fichier:ligne:  prisma/seed-portfolio.ts:2814-2819 ; app/lib/real-estate/rent-schedule.ts:113-130
Reproduction:   Seed : rentDay=5, rentalStartDate=daysAgo(900), lastRentAppliedAt=null, loyer1250€, charges180€, 0 Transaction [loyer:/[charges: en base. listPendingEntries → 30 échéances RENT + 30 CHARGES.
Effet:          Après chaque réamorçage, le bien affiche 30 mois de loyers en attente et un journal sans revenu locatif ; tout confirmer injecte +37500€/−5400€ absents du patrimoine démo mesuré. Le seed pose le curseur pour les dettes mais pas pour les loyers.
Déjà connu:     non
```
