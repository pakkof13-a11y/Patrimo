# audit-nav — app/lib/portfolio/** (daily-nav, lastCloseDay, flux idx0, weekly, cap 6 ans)

```
ID:             NAV-01
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/class-pnl-service.ts:151 (toDay = parisDayKey(now)) ; appelé par app/api/portfolio/class-pnl/route.ts:30 ; app/lib/portfolio/class-history.ts:186-200
Reproduction:   1. Un jour de bourse D, avant 05:05 Paris de D+1 (cron collect-intraday, seule alimentation d'AssetDailyClose). 2. GET /api/portfolio/class-pnl?range=1m. 3. Dernier point = D (toDay = aujourd'hui, pas lastCloseDay). 4. closeAtOrBefore reporte la clôture de D−1 → close != null → `incomplete` non alimenté (L193 ne teste que null). 5. pnl = value − prev − flow = 0 → pnlByClass = {} sur D, sans marqueur.
Effet:          Chaque jour ouvré, la barre "aujourd'hui" vaut 0 pour toutes les classes et n'est pas déclarée estimée ; sommée comme un 0 mesuré sur une fenêtre "1m". Contredit la doctrine "la courbe trace des clôtures" appliquée à daily-nav mais pas à cette route sœur ; UNKNOWN rendu comme 0.
Déjà connu:     non

ID:             NAV-02
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/historical/get-daily-nav.ts:321 (from = scopeEarliest) ; app/lib/portfolio/daily-nav-view.ts:211,229-231,269-272
Reproduction:   Mesuré (moteur seul) : achat AAPL 10×100 le 2024-03-15, close 110 le 20/03, now=2024-04-01, scope financier, période 1A. `from` demandé 2023-03-31, clampé à 2024-03-15 (naissance du scope, DANS la fenêtre). Point idx0 : {day 2024-03-15, total 1000, flows 1000, flux 0, delta 0}. En-tête : Variation=100, Flux=0, Marché=100. Contrefactuel ancre=veille (NAV 0) : Variation=1100, Flux=1000, Marché=100.
Effet:          Le point idx0 publie externalFlows=1000 mais les lecteurs de daily-nav-view le traitent comme une ancre hors fenêtre : Variation et Flux d'en-tête sous-estimés de 100% du capital du jour de naissance. Sur le même point, `flows`=1000 et `flux`=0 se contredisent. Touche tout scope/poche né à l'intérieur de la fenêtre demandée.
Déjà connu:     non (D26 a corrigé le rejeu pré-`from` ; ce cas — flux du jour de naissance porté par idx0 puis ignoré — n'y est pas couvert)

ID:             NAV-03
Gravité:        P3
Fichier:ligne:  app/lib/portfolio/historical/history-window.ts:192 (émission vendredi uniquement) ; app/lib/portfolio/historical/engine.ts:769-797
Reproduction:   Mesuré (seriesEmissionDays, from=2021-01-05) : now=2026-09-14 → lastCloseDay=2026-09-13, dernier point=2026-09-11 (écart 2j). now=2026-09-17 → lastCloseDay=2026-09-16, dernier point=2026-09-11 (écart 5j). now=2026-09-12 ou 19 → écart 0j.
Effet:          Sur 5A/Tout, asOfDay et la NAV de tête retardent de 0 à 6 jours civils sur 1A. Les flux/Δmarché lundi→lastCloseDay de la semaine en cours sont accumulés puis abandonnés (aucun point émis). Un apport du mardi apparaît en 1A et pas en 5A jusqu'au vendredi suivant. [NON MESURÉ] en euros sur données réelles.
Déjà connu:     oui (décision produit D26/D23, documentée history-window.ts:161-169)
```
