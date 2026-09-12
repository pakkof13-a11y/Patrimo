# audit-es — Épargne Salariale (CSV, dates UTC, seaux PEE/PER)

```
ID:             ES-01
Gravité:        P1
Fichier:ligne:  app/lib/employee-savings/csv.ts:89-95 (mapPlan), :102 (mapUnlockMode) ; service.ts:317
Reproduction:   CSV plan_type ∈ {PERECO, PERE, PERin, "Plan d'épargne retraite"} → tous mappés PEE/DATE. Seuls "PER Collectif","PER-COL","PERCOL" tombent en PER/PERCO. Aucune erreur remontée.
Effet:          Un PERECO (nom courant du PER collectif depuis loi PACTE) est rangé en PEE, reçoit unlockDate=contribution+5ans, passe AVAILABLE en 2029 : 1000€ bloqués jusqu'à la retraite comptés en "Déjà disponible"/esLiquidEur. byPlanType mélange PER et PEE. Défaut silencieux : tout type inconnu → PEE.
Déjà connu:     non

ID:             ES-02
Gravité:        P1
Fichier:ligne:  service.ts:331 (normalizeCreate), csv.ts:175, schemas.ts:495 ; échec à service.ts:107 (mapLine→convertToEurSync)
Reproduction:   Import CSV/POST avec currency="Dollar" ou "XYZ" (schéma=3 caractères quelconques) → stocké "DOL" ; created:1, errors:[]. GET /api/employee-savings → mapLine lève FxRateUnknownError("DOL") (vérifié : DOL,SEK,PLN,XYZ lèvent).
Effet:          Une seule ligne fautive rend TOUTES les lignes du user illisibles : GET 500, l'onglet ne charge plus (impossible de corriger depuis l'UI), getEmployeeSavingsTotalsEur fait échouer computePatrimony (Promise.all) → total patrimoine indisponible. La validation devise manque à l'écriture, l'erreur n'est levée qu'à la lecture, sur le lot entier.
Déjà connu:     non

ID:             ES-03
Gravité:        P1
Fichier:ligne:  csv.ts:173-174 (`|| "0"`) ; service.ts:48-50,329-330 (`dec(v,"0")`)
Reproduction:   a) En-têtes non aliasés → units"0", nav"0", contributionDate null, contributedAmount"300", errors[]. b) units="n/a" ou nav="" → toDecimal("n/a")→parseNumber null→fallback "0". Aucune erreur.
Effet:          Lignes créées à valeur 0 sans signalement : import "réussi" mais encours 0, gain affiché=0−300=−300€ (−100%). Violation UNKNOWN≠0 sur la valorisation elle-même.
Déjà connu:     non (D46 a unifié les séparateurs, pas le repli à zéro sur valeur absente/illisible)

ID:             ES-04
Gravité:        P2
Fichier:ligne:  overview.ts:114,270-271,347,502 (contributedAmount sommé brut) vs historical/load.ts:564-567 (converti)
Reproduction:   Ligne CHF : 100 parts×100CHF, contributedAmount 10000 (dans sa devise). marketValueEur=10638,30€ (taux 0,94). computeTotals → gain=10638,30−10000=+638,30€, +6,4%.
Effet:          Gain/performance/versements cumulés mélangent CHF et EUR ; gain réel 0 affiché +6,4%. mapLine ne publie pas contributedAmountEur.
Déjà connu:     non

ID:             ES-05
Gravité:        P2
Fichier:ligne:  overview.ts:120,129 (computeTotals) ; 285,297 (groupIntoPlans)
Reproduction:   2 lignes à 10000€ ; l1 contributedAmount 9000, l2 null. gain=11000, gainPct=122,2%, linesMissingContribution=1.
Effet:          gain = totalValue(toutes lignes) − contributed(lignes renseignées) : périmètres différents. Gain réel 1000€ (+11,1%) affiché 11000€ (+122%). Le compteur d'incomplétude existe mais le chiffre publié reste faux.
Déjà connu:     non

ID:             ES-06
Gravité:        P2
Fichier:ligne:  service.ts:395-396 (merge unlockDate)+317 ; employee-savings-form-parts.tsx:62
Reproduction:   PEE contributionDate 2020-06-15, sans unlockDate → persisté 2025-06-15 (dérivé). PUT {contributionDate:"2023-06-15"} → unlockDate reste 2025-06-15.
Effet:          Au 2026-09-12 la ligne est AVAILABLE alors qu'elle devrait être BLOCKED jusqu'au 2028-06-15. La date dérivée est persistée sans marque "auto".
Déjà connu:     non

ID:             ES-07
Gravité:        P3
Fichier:ligne:  csv.ts:97-103 (mapUnlockMode)+service.ts:320-322
Reproduction:   CSV avec unlock_date=2030-01-01 et unlock_mode vide → unlockMode RETIREMENT, puis normalizeCreate met unlockDate à null.
Effet:          Date de déblocage explicitement fournie écartée sans erreur. [NON MESURÉ] fréquence réelle.
Déjà connu:     non

ID:             ES-08
Gravité:        P3
Fichier:ligne:  service.ts:447,449 (`line:i+1` sur tableau filtré) vs csv.ts:156 (`i+2`, ligne fichier)
Reproduction:   3 lignes ; L3 rejetée (csv, line:3), L4 date invalide. rows=[A,C] → service rapporte line:2 pour C, qui est la ligne 4 du fichier.
Effet:          Le rapport d'import juxtapose 2 numérotations différentes : l'utilisateur corrige la mauvaise ligne.
Déjà connu:     non

ID:             ES-09
Gravité:        P3
Fichier:ligne:  overview.ts:242 (clé planType·manager), service.ts:326 (trim sans normalisation de casse)
Reproduction:   3 lignes manager "Amundi"/"AMUNDI"/"amundi" → 3 plans distincts.
Effet:          Un même plan éclaté en 3 cartes (planCount, byManager, nextUnlock faussés).
Déjà connu:     non

ID:             ES-10
Gravité:        P3
Fichier:ligne:  csv.ts:79-87 (mapSource → return "VOLUNTARY")
Reproduction:   source_type ∈ {Employeur, Transfert, CET} → mappés VOLUNTARY ×3, aucune erreur.
Effet:          Répartition bySource fausse (abondement employeur compté en versement volontaire, incidence fiscale différente).
Déjà connu:     non
```
