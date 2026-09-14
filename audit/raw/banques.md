# audit-banques — Liquidités (intérêts livret, parse FR)

```
ID:             BAN-01
Gravité:        P2
Fichier:ligne:  app/api/savings/route.ts:206-208 ; app/lib/cash/pockets.ts:78 ; app/lib/money/savings.ts:239-247
Reproduction:   Livret A 22950€, 2,4% APY, YEARLY (31/12), lastPayoutAt=31/12/2025. Au 15/06/2026 : displayBalance=23197,37€ (courus 247,37€). PUT balance:"22950" → lastPayoutAt=lastAccruedAt=now. Immédiatement après : displayBalance=22950,00€. Au 31/12/2026 : creditDueInterest crédite 550,80€ d'un coup.
Effet:          Le patrimoine net baisse de 247,37€ à l'instant où l'utilisateur touche un livret non-DAILY, sans flux ni événement, puis le montant réapparaît en bloc à la date de versement. L'horloge d'affichage devrait rester la dernière date de versement planifiée, pas l'instant de la saisie.
Déjà connu:     non

ID:             BAN-02
Gravité:        P2
Fichier:ligne:  app/api/banks/route.ts:149 et app/api/savings/route.ts:206 (`f.balance || "0"`) ; schemas.ts:83 (decimalString accepte "") ; bank-detail-panel.tsx:565,730
Reproduction:   Compte courant 10000€. Vider le champ Solde puis blur → commit "" → onPatch balance "0" → PUT balance "0". Par API directe idem : decimalString valide "", `"" || "0"` → balance=0, événement WITHDRAWAL −10000.
Effet:          Un champ vidé (valeur inconnue) est écrit comme 0 et journalisé comme un retrait de 10000€ : patrimoine net −10000€. UNKNOWN traité comme ZERO, dans les deux routes et l'UI.
Déjà connu:     non

ID:             BAN-03
Gravité:        P2
Fichier:ligne:  app/lib/cash/pockets.ts:157-182 (consommé par portfolio/service.ts:757-760,1103-1108)
Reproduction:   Compte pro Boursorama 40000€ + compte joint Boursorama 10000€ à 50% + CAT Boursorama 100000€. getExplicitCashTotalEur=0+5000+100000=105000€. getBankPocketCashByNameEur("boursorama")=40000+10000=50000€ (pas de personalShareOf/isPro, termDeposit non lu).
Effet:          Σ byPlatform≠Σ byClass pour le cash : le camembert "par plateforme" compte 40000€ de pro exclus du net, 5000€ de quote-part tierce, omet 100000€ de CAT. Net worth non affecté.
Déjà connu:     non

ID:             BAN-04
Gravité:        P3
Fichier:ligne:  schemas.ts:81-86 (decimalString, utilisé bankAccountSchema:383, savingsAccountSchema:408, termDepositSchema:436)
Reproduction:   "1 234,56"→400 ; "1 234,56" (U+202F, format du formateur de l'app)→400 ; "1.234,56"→400 ; "-1 000"→400. "22950,5"→OK.
Effet:          Tout montant copié depuis un relevé FR ou depuis l'affichage de l'app lui-même est refusé (400 explicite). parseNumber gère ces formats mais n'est branché que sur les alternatifs, pas banques/livrets/CAT.
Déjà connu:     partiellement (unification parseNumber limitée aux alternatifs)

ID:             BAN-05
Gravité:        P3
Fichier:ligne:  app/lib/money/savings-accrual.ts:57,83-94 ; portfolio/historical/load.ts:350 ; historical/components.ts:117-134
Reproduction:   Livret antérieur au journal (0 événement), apyPercent 0, DAILY, solde 5000€, jamais PUT. Chaque cron accrue : periodsCredited=1 → updatedAt=aujourd'hui ; recordSavingsAccountInterest ne pose rien (lte 0). load.ts : knownAt=updatedAt=aujourd'hui.
Effet:          Le livret est absent de toute la courbe et "réapparaît" comme apport de 5000€ chaque jour ; compartiment cash marqué estimé en permanence. [NON MESURÉ] population concernée.
Déjà connu:     non

ID:             BAN-06
Gravité:        P3
Fichier:ligne:  app/lib/cash/bank-groups.ts:75-78,99,107,121,132
Reproduction:   num()=Number() ; totalBase += num(...). Trois produits à 0.1/0.2/0.3 → totalBase=0.6000000000000001 ; tri par num(b)-num(a).
Effet:          Total par établissement et ordre de tri en float alors que les entrées sont des chaînes Decimal. Écart masqué à l'affichage. Violation "Decimal.js, jamais de float" sans impact chiffré visible.
Déjà connu:     non

ID:             BAN-07
Gravité:        P3
Fichier:ligne:  app/lib/cash/term-deposits-list.ts:22-31 ; pockets.ts:107-111 ; historical/load.ts:369-371
Reproduction:   CAT 100000€, 3%, ouvert 01/09/2025, échéance 01/09/2027. Au 12/09/2026 : principalBase=100000 ; à l'échéance : toujours 100000, status MATURED.
Effet:          ~3000€ d'intérêts acquis après un an (6000€ à l'échéance) n'entrent ni dans le bandeau Banques ni dans le net ni dans la courbe.
Déjà connu:     oui (docs/d39b-depots-a-terme-hors-patrimoine.md point 3 ; commentaire load.ts:369) — choix documenté, pas un oubli
```
