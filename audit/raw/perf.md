# audit-perf — 504 Hobby, weekly

```
ID:             PER-01
Gravité:        P1
Fichier:ligne:  app/api/cron/collect-intraday/route.ts:255-258 ; intraday-collector.ts:439-497
Reproduction:   maxDuration=60, WORK_BUDGET_MS=45000 ne protège que backfillDailyClosesFromFirstTx. Dès que le backfill termine sans avoir consommé les 45s (stoppedForBudget=false), collectIntradayBars est lancé sans deadline propre : boucle séquentielle, chaque fetchHistory pouvant timeouter à 12000ms.
Effet:          Si le backfill consomme ~44-50s et que 2 actifs de la phase intraday timeoutent (12s×2=24s), total>60s → 504 : le rapport de backfill déjà écrit en base est perdu côté réponse HTTP. Le commentaire dit que l'intraday n'est sauté que si stoppedForBudget=true, pas quand il termine de justesse sous le seuil.
Déjà connu:     non

ID:             PER-02
Gravité:        P1
Fichier:ligne:  app/api/crypto/defi/sync/route.ts:51 ; defi-sync.ts:187-345
Reproduction:   Aucun maxDuration → budget par défaut Hobby ~10s. Corps : 1 appel Zerion throttlé 1,1s + boucle séquentielle sur jusqu'à 50 positions, chacune ~5-6 écritures/lectures Prisma successives.
Effet:          Le même schéma a justifié maxDuration=60 sur wallets/zerion/sync. crypto/defi/sync fait un travail comparable ou supérieur sans le même maxDuration : sur un wallet à 15-20 positions DeFi, dépassement probable de 10s, réponse jamais rendue, curseur de sync non mis à jour. [NON MESURÉ directement]
Déjà connu:     non (distinct de wallets/zerion/sync et crypto/defi/valuations/refresh, déjà corrigés)

ID:             PER-03
Gravité:        P2
Fichier:ligne:  app/api/market/quotes/route.ts:80-84 ; app/lib/utils/with-timeout.ts:11-13
Reproduction:   withTimeout(yahooFinance.quote(...), 10000) fixe le repli applicatif à 10000ms, identique au budget par défaut Vercel Hobby (10s) qu'aucun maxDuration ne relève ici. Le timer démarre après auth/cache/rate-limit déjà consommés.
Effet:          Quand Yahoo répond en 9-10s, la plateforme coupe la fonction avant que le catch ne rende la réponse dégradée à 200 (unavailable:true) prévue par le code : remplacé par un 504 brut au lieu du repli gracieux documenté. [NON MESURÉ directement]
Déjà connu:     non
```
