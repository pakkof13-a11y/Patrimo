# audit-trading — Trading (CFD hors comptes, levier)

```
ID:             TRA-01
Gravité:        P1
Fichier:ligne:  app/lib/trading/account-service.ts:122 ; app/lib/portfolio/allocation-by-venue.ts:619
Reproduction:   Compte IG (CFD) balance=10000 EUR, marginAvailable=8000, 1 position marginUsed=2000 EUR. listTradingAccounts n'est consommé que par l'affichage /api/trading. allocation-by-venue ne charge que tradingPosition.
Effet:          Manche "Trading" = 2000 EUR ; les 8000 EUR de cash/marge libre du compte n'entrent dans aucun total. Compte sans position ouverte = 0 partout. Le solde déclaratif du courtier est un champ mort pour le patrimoine.
Déjà connu:     non (FIN-05 = trading absent de patrimony-metrics ; ici le solde de compte est absent y compris d'allocation-by-venue)

ID:             TRA-02
Gravité:        P1
Fichier:ligne:  app/lib/crypto/futures-import-service.ts:51 ; futures.ts:145
Reproduction:   CSV Binance sans colonne leverage : leverage=1.00 par défaut. Lecture : toFuturesView → margin=notional/leverage=30000/1=30000 (levier réel x10).
Effet:          /api/trading marginUsedEur=30000 au lieu de 3000 (x10) ; pnlPct divisé par 10 ; overview.marginEur gonflé de 27000 ; estimation de liquidation à 0,5% de l'entrée (aucune alerte possible). UNKNOWN (levier absent) converti en 1.
Déjà connu:     non

ID:             TRA-03
Gravité:        P1
Fichier:ligne:  app/lib/crypto/futures.ts:47-49,113-123 ; futures-import-service.ts:26,52
Reproduction:   Import Binance COIN-M, BTCUSD_PERP, qty10 (contrats de 100 USD), price60000, levier absent. notional=size×entry=600000 USD au lieu de 1000 USD réel (x600). marginType=COIN_M stocké puis ignoré par tous les calculs.
Effet:          Manche Trading ≈550000 EUR d'equity inventée pour un notionnel réel de 1000 USD. Même formule fautive pour le P&L.
Déjà connu:     non

ID:             TRA-04
Gravité:        P2
Fichier:ligne:  futures.ts:145-146 ; positions-view.ts:209
Reproduction:   Position LONG notional10000 USDT, leverage déclaré10, marginUsed déclaré5000 (marge isolée abondée). estimatedLiquidationPrice ignore marginUsed → liq=entry×(1−0,1+0,005)=−9,5% au lieu de ≈−49,5% (levier effectif x2).
Effet:          liquidationAlert=true (fausse alerte) alors que le levier effectif réel est bien plus faible ; levier affiché ("×10") ≠ levier réellement pris.
Déjà connu:     non

ID:             TRA-05
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/allocation-by-venue.ts:344,545,551
Reproduction:   Pos A margin1000 USD pnl+500 → equity1500. Pos B margin1000 USD pnl−1800 → equity−800 (perte en marge isolée bornée à la marge réellement, ici pas plafonnée). venues.trading=700.
Effet:          Manche Trading 700 au lieu de 1500. Avec B seule : venue=−800, écartée par amount.gt(0) sans compteur ni signal (contrairement à unallocatedLiabilitiesEur pour l'immo).
Déjà connu:     non

ID:             TRA-06
Gravité:        P2
Fichier:ligne:  app/api/trading/route.ts:139,152 ; futures-service.ts:54-58,94
Reproduction:   underlyingType/tickValue jamais écrits par aucun create/update ; seul chemin d'écriture = crypto exchanges/import CSV → underlyingType="CRYPTO" par défaut.
Effet:          Aucune position CFD indice/forex/matière première ne peut exister proprement ; tickValue jamais renseigné → pour un CFD indice saisi via le wizard crypto, notionnel sans valeur du point (CAC40 1 contrat 10€/pt, 7500pts : 7500 calculé vs 75000 réel). [NON MESURÉ sur données réelles]
Déjà connu:     non

ID:             TRA-07
Gravité:        P3
Fichier:ligne:  app/api/trading/route.ts:58 vs positions-view.ts:168-173 et route.ts:76-78
Reproduction:   Position close manuellement : realizedPnl=+1000, commissionPaid=50, fundingPaid=20. analytics reçoit realizedPnlEur=1000 brut ; overview et fiscal déduisent les frais (930).
Effet:          Trois "résultats réalisés" différents sur le même écran (1000/930/930) ; winRate/profitFactor/drawdown calculés hors frais.
Déjà connu:     partiellement (FIN-03 couvre la double déduction à l'import ; ici absence de déduction pour les clôtures manuelles)

ID:             TRA-08
Gravité:        P3
Fichier:ligne:  app/api/crypto/futures/route.ts:34 ; futures-service.ts:46-50,116
Reproduction:   POST marginUsed="-500" accepté (regex + isFinite seulement).
Effet:          equity allocation=−500+pnl (négatif écarté silencieusement, cf. TRA-05), pnlPct=null, fundingAlert=false. Hors périmètre strict (app/api/crypto) mais alimente app/api/trading.
Déjà connu:     non
```
