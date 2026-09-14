# audit-seed — données démo (hors passifs/loyers déjà audités)

```
ID:             SEED-01
Gravité:        P1
Fichier:Ligne:  prisma/seed-portfolio.ts:2582-2605
Reproduction:   Boucle de génération de clôtures récentes sans test isWeekend/previousBusinessDay (existants et utilisés 40 lignes plus bas pour la même table, ligne 2633). Simulation sur les 31 positions du seed : 25 036 clôtures AssetDailyClose générées, dont 7 175 (28,7%) tombent un samedi ou dimanche.
Effet:          Clôtures inventées un jour où les marchés actions/ETF/obligations (MC.PA, TTE.PA, AAPL, MSFT, ASML.AS, NESN.SW, IWDA.AS, l'OAT, AIR.PA, OR.PA, SU.PA, SAN.PA, RMS.PA, CAC.PA, AI.PA, C50.PA, CW8.PA…) sont fermés. Aucun jour férié exclu non plus. Seules les 5 lignes crypto (cotent 7j/7) ne sont pas concernées. La boucle jumelle de l'historique long (≤2019, lignes 2625-2641) applique correctement previousBusinessDay — omission locale à cette boucle précise.
Déjà connu:     non
```

Vérifications sans nouveau constat : les 2 amortissements côté seed (P10 "Crédit immo Lyon 2006" en avant, "Crédit immo Lyon" en arrière) appliquent la même règle intérêts-puis-capital de façon cohérente entre eux ; l'écart de montant mesuré sur le "Crédit conso auto" (6 200€) correspond exactement à PAS-02 (audit 1), pas un nouveau défaut ; les montants du reste du seed (métaux, PE, crowdlending, tangibles, épargne salariale, trading à levier) restent d'un ordre de grandeur plausible, sans facteur ×10/÷10 apparent.
