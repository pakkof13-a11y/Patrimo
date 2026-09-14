# audit-macro — Calendrier J/J+6, earnings, sources FR

```
ID:             MAC-01
Gravité:        P1
Fichier:ligne:  app/lib/news/earnings-live.ts:392-409
Reproduction:   finnhubRowToEvent() fixe hh:mm par étiquette Finnhub (bmo→07:30, amc→17:30, dmh→14:00 Paris) puis construit `time` en heure Paris. Or Paris=ET+6h (été/hiver) : ouverture NYSE 9:30 ET=15:30 Paris, clôture 16:00 ET=22:00 Paris.
Effet:          "amc" (après clôture) reçoit 17:30 Paris = 11:30 ET — 4h30 avant la clôture réelle. "dmh" reçoit 14:00 Paris = 08:00 ET, avant même l'ouverture. Ce `time` synthétique sert de base au classement À venir/Publiées et à la fenêtre J−6…J+6 dès qu'aucun événement Yahoo n'existe pour le même ticker/jour. Un résultat AMC bascule "Publiées" jusqu'à ~4h30 avant sa sortie réelle.
Déjà connu:     non

ID:             MAC-02
Gravité:        P2
Fichier:ligne:  app/lib/news/macro-live.ts:171-224
Reproduction:   Mesuré en direct : fetch ff_calendar_thisweek.json à 2026-09-12T22:18:53Z (déjà dimanche côté Paris) → 81 lignes, jours 2026-09-06→09-12 (aucune ligne au-delà). resolveMacroCalendarWeek() ne clampe/complète jamais cette fenêtre (pas de from/to comme earnings-live.ts).
Effet:          Un utilisateur Paris consultant "À venir" (J…J+6) pendant cette fenêtre récurrente hebdomadaire (source ancrée sur un jour US, pas Paris) : 0/7 jours couverts, liste vide sur toute la semaine à venir au moment précis où elle démarre. Correctement étiqueté "hors fenêtre" (pas de faux zéro) mais fonctionnalité indisponible pendant ce créneau.
Déjà connu:     non

ID:             MAC-03
Gravité:        P3
Fichier:ligne:  app/lib/news/release-filter.ts:43-94
Reproduction:   filterMacroByRelease/filterEarningsByRelease départagent via présence du chiffre, fenêtres différentes de celles réellement servies (app/api/macro/route.ts, app/api/earnings/route.ts, split sur l'heure). Aucun import hors tests/unit/market-release-filter.test.ts.
Effet:          Code mort contredisant la règle actuelle ("se départage sur l'heure, jamais sur la présence du chiffre"), activement testé comme correct. Aucun impact utilisateur actuel ; risque de régression si reconnecté par erreur.
Déjà connu:     non
```
