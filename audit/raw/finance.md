# audit-finance — Portefeuille (Net/Brut/venues/P&L/latent/réalisé/écart CFD)

```
ID:             FIN-01
Gravité:        P1
Fichier:ligne:  app/lib/portfolio/service.ts:960-961,996 (idem app/lib/portfolio/historical/engine.ts:1282, service.ts:1572-1579, snapshot service.ts:1147-1150)
Reproduction:   1. Journal : ACHAT AAPL 10×100€ ; ACHAT 1 position DeFi 5000€ (defi-manual-service.ts:790-797 crée un ACHAT à coût). 2. Marquer la position DeFi `isIgnoredInPortfolio=true` → getHoldings la saute (service.ts:322). 3. Cours AAPL 120€. marketValue = Σ holdings filtrés = 1200 ; costBasis = totalCostBasis(ledger) non filtré = 6000. 4. Script pure-fn : unrealized = 1200 − 6000.
Effet:          summary.unrealizedPnlEur = −4800€ alors que Σ holdings.unrealizedPnlEur = +200€. Même biais sur unrealizedPnlBase de la courbe, totalCostBasisEur, PortfolioSnapshot, getPlatformCashBalances.unrealizedPnlEur (aucun filtre d'exclusion). Le latent publié est faux du coût de revient de chaque actif exclu (DeFi/NFT ignorés, NFT BORROWED_IN).
Déjà connu:     non

ID:             FIN-02
Gravité:        P1
Fichier:ligne:  app/api/trading/route.ts:56-62,72-78,172-179 ; app/lib/trading/positions-view.ts:180-183,272-286 ; app/lib/crypto/futures.ts:131,135,160,164
Reproduction:   1. Position BTC/USDT-PERP, quoteCurrency USDT, size1, entry 60000, mark 61000, marge 6000. 2. Position CFD CAC40, quoteCurrency EUR, size10, entry 7500, mark 7600, marge 3750. 3. /api/trading sert derived.unrealizedPnlEur/notionalEur/marginUsedEur sans conversion. 4. computeTradingOverview additionne 1000 USDT + 1000 EUR.
Effet:          overview.unrealizedPnlEur = 2000 "€", marginEur = 9750 "€", notionalEur = 60000 "€" pour 60000 USDT. Même chaîne pour le réalisé : realizedPnl (devise cotation) alimente computeTradingAnalytics/computeTradingYear → assiette "taxableEur"/PFU calculés sur des USDT non convertis (écart 7,4% à 1,08). tradingEquityEur (allocation-by-venue.ts) est le seul point converti — rend null pour USDT.
Déjà connu:     partiellement — suffixe "Eur" abusif documenté dans allocation-by-venue.ts:20-24,349-353, corrigé uniquement pour le donut ; non corrigé sur /api/trading, positions-view, analytics, tax.

ID:             FIN-03
Gravité:        P1
Fichier:ligne:  app/lib/crypto/futures-import-service.ts:54-60,88-90 ; app/lib/trading/positions-view.ts:168-173 ; app/api/trading/route.ts:72-78 ; app/lib/crypto/futures-service.ts:187-201
Reproduction:   1. Import CSV ligne close : closedPnl 1000, fee 20, funding 50. 2. applyFuturesImport stocke realizedPnl=realizedNetPnl=1000−50−20=930 ET fundingPaid=50, commissionPaid=20. 3. UI closedNetPnl(row) = 930−50−20 = 860. 4. /api/trading fiscal : gains=930, fees=70 → taxableEur=860.
Effet:          Frais déduits deux fois sur toute position importée : P&L et assiette fiscale sous-évalués de 70€ sur 1000 (mesuré 930→860). La même colonne realizedPnl porte deux sémantiques (nette à l'import, brute via closeFuturesPosition) — impossible de savoir ligne par ligne ce que le chiffre publié contient.
Déjà connu:     non

ID:             FIN-04
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/allocation-by-venue.ts:201-204,532-538,720-723 (vs app/lib/alternatives/portfolio.ts:134-150, historical/components.ts:265-272)
Reproduction:   1. CrowdlendingPosition ACTIVE : capitalInvested 10000, remainingCapital 4000. 2. computeAllocationByVenue → slice alt = 10000. 3. getAlternativesPortfolioSlice → effectiveRemainingCapital=4000 ; courbe = remainingCapital.
Effet:          Donut "Alternatifs" = 10000€ contre 4000€ dans Brut/Net et la courbe : +6000€ sur une ligne. La décision "crowdlending compte sur remainingCapital" n'est pas appliquée à la répartition par venue ; test allocation-by-venue.test.ts:346-353 verrouille le capital investi.
Déjà connu:     non

ID:             FIN-05
Gravité:        P3
Fichier:ligne:  app/lib/portfolio/patrimony-metrics.ts:154-161,279-324 (aucune entrée trading) vs app/lib/portfolio/allocation-by-venue.ts:544-546,653-674
Reproduction:   1. TradingPosition ouverte, quoteCurrency USD, marge 6000, latent +1000. 2. allocationByVenue → tradingEquityEur = 7000/1,08 = 6481,48€ dans la manche Trading. 3. getPortfolioBundle → computePatrimonyMetrics n'a pas d'entrée trading : brut/net inchangés.
Effet:          6481,48€ présents dans le donut, 0€ dans Brut et Net. Deux périmètres pour la même marge déposée. Décision produit à remonter (périmètre affiché), pas un défaut de calcul.
Déjà connu:     oui — exclusion documentée (e2e/coherence-totaux.spec.ts:479-481, allocation-by-venue.ts:4-6 "les écarts sont voulus")

ID:             FIN-06
Gravité:        P3
Fichier:ligne:  app/lib/portfolio/service.ts:757-760,1102-1113 (vs :962,983 et patrimony-metrics.ts:23-24)
Reproduction:   1. Plateforme "Boursorama" avec APPORT 5000 au journal ; BankAccount bankName "Boursorama" solde 5000. 2. getPlatformCashBalances : cashEur = ledgerCash + pocketCash rattaché par nom = 10000. 3. allocation.byPlatform[Boursorama] += 10000 ; byClass.CASH = cash explicite = 5000 ; brut compte 5000.
Effet:          [NON MESURÉ] Σ byPlatform ≠ Σ byClass ≠ brut : le cash "fantôme" du journal, exclu du brut par contrat, réapparaît dans byPlatform et double le cash saisi quand le nom coïncide.
Déjà connu:     non
```
