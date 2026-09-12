# audit-market — sessionGap, short, OOM, 8-11 sept

```
ID:             MAR-01
Gravité:        P1
Fichier:ligne:  app/lib/market/backfill-closes.ts:314 (fromDateForAsset→fillDailyCloses), :179-181 (needsHistoryBackfill)
Reproduction:   Cron 03:05 Paris. Pour tout actif coté : maxDay=J−1 (Yahoo n'a pas encore J) < toDay=J, fetchedAt=24h → stale=true. from = fromDateForAsset(firstTx) clampé 6 ans, jamais "maxDay+1" : l'appel redemande toute la fenêtre. 6 ans×~252 séances≈1510 clôtures/actif/jour. Fixture preview : 95 actifs, 42 stale → 42×1510≈63000 lignes réseau+SQL par passage.
Effet:          Le "no-op si cache complet" annoncé n'existe jamais sur le cron (maxDay<toDay chaque nuit). Chaque nuit = re-téléchargement intégral 6 ans de chaque actif. Le budget 45s est consommé par ce volume, barres intraday jamais collectées tant que le compte a plus d'actifs que le budget n'en absorbe.
Déjà connu:     non (le cap 6 ans réduit le volume par actif ; il ne change pas le fait qu'on refetch tout, tous les jours)

ID:             MAR-02
Gravité:        P1
Fichier:ligne:  app/lib/market/backfill-closes.ts:171-177 (minDay vs firstTxDay+10 non clampé) contre :237 (from clampé à MAX_HISTORY_YEARS)
Reproduction:   Mesuré (now=2026-09-13) : floor=2020-09-13. Cache complet et frais : firstTx=2019-06-14→stale=true ; 2016-04-12→true ; 2020-09-01→true ; 2020-09-05→false. Un actif dont firstTx+10j<floor ne peut jamais atteindre minDay≤firstTx+10 : le fetch est clampé à floor, la condition ne l'est pas. Régression introduite par 499a634 (plancher 30 ans→6 ans), roulante.
Effet:          Ces actifs sont stale à chaque passage quelle que soit la fraîcheur, refetch 6 ans à chaque POST. needsMoreRuns:true permanent, intraday sauté à chaque appel.
Déjà connu:     non

ID:             MAR-03
Gravité:        P2
Fichier:ligne:  app/lib/market/backfill-closes.ts:179-181
Reproduction:   needsHistoryBackfill garde l'ancienne règle "maxDay≥toDay sinon throttle 6h", sans sessionGap. Mesuré : lundi connu, toDay jeudi, fetchedAt 2h → stale=false (sessionGap=3) — le cas 8-11 sept SURVIT sur le chemin cron par défaut. Inverse le week-end : dimanche dernière clôture vendredi, fetchedAt 24h → stale=true (sessionGap=0), refetch complet pour 0 séance manquante.
Effet:          Deux notions de fraîcheur coexistent : daily-closes.ts (sessionGap, corrigé) et backfill-closes.ts (ancienne règle, pas corrigé) — malgré le commit b6712e1 disant "backfill-closes.ts intact".
Déjà connu:     non

ID:             MAR-04
Gravité:        P2
Fichier:ligne:  app/api/cron/collect-intraday/route.ts:189-192,255-258 ; intraday-collector.ts:439-497
Reproduction:   budget (deadlineAt=t0+45s) n'est passé qu'au backfill. collectIntradayBars n'a aucun paramètre d'échéance, boucle séquentielle 12s timeout unitaire. Backfill terminé à 44s → intraday démarre avec 1s de budget théorique. ?mode=short : ni collectDailyClosesForAssets ni l'intraday ne sont budgétés.
Effet:          504 à 60s avec rapport perdu — le scénario que WORK_BUDGET_MS devait exclure.
Déjà connu:     non

ID:             MAR-05
Gravité:        P2
Fichier:ligne:  app/lib/market/price-history.ts:359-364 (coingeckoDaysParam),:378-388
Reproduction:   Backfill crypto : from=6ans → days=2191 ; entretien 365j → days=366. CoinGecko /ohlc : granularité 3-30j=4h, ≥31j=bougies 4 jours. Seul ?mode=short (10j→days=11) produit des clôtures journalières.
Effet:          Série crypto AssetDailyClose à 1 point/4 jours sur les 2 chemins longs ; dernière clôture jusqu'à 3 séances en arrière → sessionGap>1 → stale à chaque passage, throttle ignoré. [NON MESURÉ, pas de réseau dans cet audit]
Déjà connu:     non

ID:             MAR-06
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/historical/load.ts:625-641 (loadCloses) ; app/lib/market/daily-closes.ts:49-76
Reproduction:   readDailyCloses(assetIds, first, today) sans borne : first=1ère transaction utilisateur, non capée par historyFloorDay. Les lignes écrites avant 499a634 (4000-6500/actif) restent en base — le cap borne la collecte, pas la lecture.
Effet:          Chemin mémoire non couvert par le cap : chaque lecture d'historique matérialise l'intégralité pré-cap en Decimal, jamais servie au-delà de 6 ans. [NON MESURÉ]. Correctif côté lecture → backend-nav.
Déjà connu:     non

ID:             MAR-07
Gravité:        P3
Fichier:ligne:  app/lib/market/last-close-as-of.ts:122-132 (sessionGap) appelé par daily-closes.ts:120,397
Reproduction:   Mesuré : sessionGap("2020-09-13","2026-09-13")=1565 séances en 52,3ms (4 appels Intl/jour). 100 appels=4418ms.
Effet:          assetsNeedingFetch boucle sur tous les actifs à chaque passage : un actif à clôture ancienne coûte ~50ms/actif/passage. Un simple garde avant sessionGap suffirait.
Déjà connu:     non

ID:             MAR-08
Gravité:        P3
Fichier:ligne:  daily-closes.ts:120-127,397 ; last-close-as-of.ts:107-110
Reproduction:   sessionGap exclut sam/dim pour toutes les classes, CRYPTO comprise (cote 7j/7). Dimanche, dernière clôture vendredi : gap=0 → non stale, covered.
Effet:          Clôtures crypto de samedi/dimanche jamais demandées avant lundi ; coverage annonce "couvert" avec 2 jours réellement manquants. [NON MESURÉ]
Déjà connu:     non
```
