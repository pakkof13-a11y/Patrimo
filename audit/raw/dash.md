# audit-dash — Hero, chips, KPI, donut venues

```
ID:             DAS-01
Gravité:        P1
Fichier:ligne:  components/dashboard/terminal-hero.tsx:280-284,764-772 ; dashboard-tab.tsx:385 (referenceDay=lastCloseDay()),835-837,581-588,879/882
Reproduction:   Passif de 100000€ hier soir. Remboursement de 20000€ aujourd'hui. netWorth (résumé "live") passe immédiatement de X à X+20000. windowed vient de getDailyNav fenêtré jusqu'à lastCloseDay() = hier ("veille" systématique, jamais aujourd'hui) : liabilitiesNow reste à 100000€, pas 80000€.
Effet:          La carte de tête affiche "Patrimoine [X+20000]€ … dont passifs 100000€" : le chiffre de tête et le sous-texte juste en dessous, dans la même carte, ne se recoupent plus dès qu'un mouvement de passif est saisi le jour même — alors que la tuile KPI "Passifs" voisine affiche déjà, elle, le bon montant 80000€. Deux affichages du même total sur le même écran divergent de 20000€.
Déjà connu:     non

ID:             DAS-02
Gravité:        P2
Fichier:ligne:  app/lib/portfolio/kpi-series.ts:170-176 (seriesChangeAbs),195-203 (seriesChangePct) ; dashboard-tab.tsx:734-829 ; terminal-hero.tsx:1229-1257
Reproduction:   Une poche vaut 0 en début de fenêtre puis reçoit un apport en cours de période : série "Crypto"=[0,0,12000,12360] sur 3M. seriesChangeAbs=12360−0=+12360€ (base=1er point, 0). seriesChangePct ignore ce 0 et prend la 1ère valeur non nulle (12000) comme base : (12360−12000)/12000×100=+3,0%.
Effet:          La tuile affiche "+12360,00€ · +3,0% · 3M" comme si les 2 nombres décrivaient le même écart : ils ne partagent pas la même base (0€ vs 12000€). Le % sous-entend un patrimoine de départ ≈412000€ dans cette classe, alors qu'il valait 0€ au début réel de la fenêtre.
Déjà connu:     non
```
