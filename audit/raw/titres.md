# audit-titres — Securities (PEA/CTO, CUMP, obligations vs Actions)

```
ID:             TIT-01
Gravité:        P1
Fichier:ligne:  app/lib/securities/fiscal-service.ts:447 (gainEur = VL − deposits) ; components/securities/securities-tab.tsx:292
Reproduction:   PEA mûr, DEPOSIT 100 000, VL 150 000, WITHDRAWAL 50 000 déclaré → VL 100 000. Retrait simulé 100 000. Vérifié : app → gain 0,00/PS 0,00 ; règle BOI-RPPM-RCM-40-50-50 (versements restants = 100 000 − 50 000×100 000/150 000 = 66 666,67) → gain 33 333,33/PS 6 200,00.
Effet:          Après tout retrait partiel, la quote-part de versements déjà sortie reste dans l'assiette : gain PEA et impôt de retrait sous-estimés (−6 200€ ici), à 0 alors qu'il ne devrait pas l'être. Minorant fail-open, contraire à la doctrine "majorante" de pea.ts:40. withdrawalsEur collecté mais jamais réinjecté.
Déjà connu:     non

ID:             TIT-02
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/service.ts:96-104 (loadLedgerForUser, repli clampOversell) ; app/lib/accounting/ledger.ts:145-147
Reproduction:   ACHAT 10×100€ daté 2025-03-10, VENTE 10×120€ saisie 2025-03-01 (date erronée). 1er rejeu lève INSUFFICIENT_QTY → 2e rejeu clampOversell : VENTE ignorée (break), position qty 10/coût 1000€, realizedLots=0.
Effet:          Une seule écriture invalide bascule tout le journal utilisateur en mode clamp+cash négatif, sans compteur ni signal : 1000€ de titres fantômes au PRU, 200€ de P&L réalisé perdus. Viole "un échec ne se tait pas".
Déjà connu:     non

ID:             TIT-03
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/asset-values.ts:78-80 ; app/lib/securities/positions-service.ts:16-40 (aucun priceSource/priceStatus) ; app/lib/market/registry.ts:30
Reproduction:   Actif OBLIGATIONS, ACHAT 10×1000€, sans manualPrice ni quote → priceEur := costBasis/qty → /api/securities rend marketValueEur 10000,00, unrealizedPnlEur 0,00 — indiscernable d'une cotation réelle à plat.
Effet:          UNKNOWN rendu comme P&L=0 et valeur liquidative (entre dans l'assiette de TIT-01). getHoldings pose `priceSource:"coût"` mais la route titres perd ce drapeau.
Déjà connu:     non

ID:             TIT-04
Gravité:        P2
Fichier:ligne:  app/lib/securities/overview.ts:650 (EQUITY_LIKE) et :585-590 ; app/api/assets/route.ts:118-137 (POST n'écrit jamais category)
Reproduction:   Ligne A assetClass OBLIGATIONS/category ETF 60000€ + ligne B EQUITY 40000€ → equityExposurePct=100% (attendu 40%). Ligne créée via POST → category UNCLASSIFIED alors que le dashboard la range en OBLIGATIONS par assetClass.
Effet:          Classification action/obligation de la page Titres fondée sur la sous-catégorie UI et jamais sur assetClass : exposition actions surestimée (+60 pts), deux écrans en désaccord sur la même ligne.
Déjà connu:     non

ID:             TIT-05
Gravité:        P3
Fichier:ligne:  app/lib/securities/fiscal-service.ts:156-159 (recordContribution)
Reproduction:   POST contribution {DEPOSIT, 150000, occurredAt:"2030-01-01"} → 201 ; room.remainingEur=0 immédiatement. Idem versement antérieur à openDate.
Effet:          Un versement futur ou antérieur à l'ouverture consomme le plafond dès aujourd'hui ; parseOpenDate refuse le futur pour le compte mais pas pour ses versements.
Déjà connu:     non

ID:             TIT-06
Gravité:        P3
Fichier:ligne:  app/lib/securities/fiscal-service.ts:393-405,433-440 ; app/lib/securities/pea.ts:320 (closesPea)
Reproduction:   PEA ouvert 2024-01-01, DEPOSIT 10000, WITHDRAWAL 5000 en 2025 → /api/securities rend room.remainingEur 140000, maturity en cours ; nouveaux DEPOSIT acceptés.
Effet:          Un retrait avant 5 ans clôture le plan (hors exception) ; le simulateur l'affirme mais le journal des versements continue d'offrir place et maturité. [NON MESURÉ] (dépend des cas d'exception).
Déjà connu:     non
```
