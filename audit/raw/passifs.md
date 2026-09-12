# audit-passifs — Dettes, 3 amortissements, seed remainingAfter

```
ID:             PAS-01
Gravité:        P1
Fichier:ligne:  app/lib/liabilities/amortization.ts:176-191 (applyMonthlyDebit) vs :317-386 (buildAmortizationSchedule) et :17-37 (estimateRemainingMonths)
Reproduction:   1. Seul modèle qui pilote remainingAmount (projectDuePayments → applyMonthlyDebit) : capital −= mensualité entière, taux ignoré. 2. Les deux autres calculs du même fichier (tableau prévisionnel, durée/intérêts restants) sont en annuité. 3. Prêt démo 178500€ @2,15%, 980€/mois, 60 échéances dues au 12/09/2026 : moteur → 119700€ ; annuité → 136720,72€. 4. Panneau : ligne1 du tableau (annuity) donne remainingAfter 177840,01 ; le mois suivant la tuile affiche 177520 (−320€/mois cumulatif). 5. monthsRemaining=221 (annuité) alors que le solde tombe à 0 en 183 débits ; endDate réécrite par service.ts:167-173 avec la formule annuité.
Effet:          Dette sous-estimée de 17020,72€ sur le prêt démo après 60 mois ; patrimoine net et assiette IFI surestimés d'autant ; 3 grandeurs du même écran (solde, tableau, durée) incompatibles entre elles.
Déjà connu:     oui (commentaire prisma/seed-portfolio.ts:2986-2988 "c'est un défaut distinct") — aucun correctif ni ticket trouvé.

ID:             PAS-02
Gravité:        P1
Fichier:ligne:  app/lib/liabilities/amortization.ts:519-565 (projectDuePayments) ; app/api/liabilities/route.ts:138-162 ; prisma/seed-portfolio.ts:2936-2955,3026-3042
Reproduction:   1. Créer une dette avec startDate passée, remainingAmount = solde d'aujourd'hui, paymentDay, monthlyPayment. 2. lastPaymentAppliedAt reste null → duePaymentDates repart du mois de startDate et rejoue N échéances sur le solde saisi. 3. Seed "Crédit immo Lyon" : 178500 saisi, start 2021-10-03 → 60 dates → affiché 119700€. 4. Seed "Crédit conso auto" : 6200 saisi, start 2024-10-12 → 23×320=7360>6200 → affiché 0€, statut SETTLED, alors que endDate=+200j.
Effet:          −58800€ et −6200€ de dette sur le compte démo (patrimoine net +65000€). Même mécanique sur le chemin utilisateur réel (POST). Le test liabilities-projection.test.ts:35-37 fige ce comportement comme attendu.
Déjà connu:     non (codifié comme attendu par le test, pas comme défaut)

ID:             PAS-03
Gravité:        P2
Fichier:ligne:  prisma/seed-portfolio.ts:2990-3006 ; app/lib/portfolio/historical/components.ts:400-421
Reproduction:   1. Le seed écrit 12 MONTHLY_DEBIT en annuité à rebours : remainingAfter=178500 à J−30, 179159,01 à J−60. 2. Le moteur recalcule aujourd'hui 119700 (PAS-02). 3. buildLiabilitiesSleeve ancre ce 119700 au jour updatedAt (postérieur à J−30). 4. Chronologie : 178500 (J−30) → 119700 (jour du seed).
Effet:          Marche de −58800€ sur la courbe passifs / +58800€ sur le patrimoine net en un jour ; les remainingAfter du seed et le solde recalculé par le moteur ne décrivent pas le même prêt.
Déjà connu:     non

ID:             PAS-04
Gravité:        P2
Fichier:ligne:  app/lib/liabilities/service.ts:428-484 (changeMonthlyPayment) ; :450,464 (remainingAfter=solde stocké)
Reproduction:   1. Prêt démo : stocké 178500, affiché 119700 (60 échéances non matérialisées). 2. POST avenant mensualité 980→1200 : aucune matérialisation préalable (volontaire). 3. Projection suivante : 178500−60×1200=106500€ (au lieu de 119700). 4. L'événement PAYMENT_CHANGE écrit remainingAfter=178500 (stocké) et endDate projetée depuis 178500.
Effet:          Un avenant pour le futur réécrit 60 mois de passé : −13200€ de dette instantanément ; journal affichant 178500 quand l'écran affiche 119700.
Déjà connu:     non

ID:             PAS-05
Gravité:        P3
Fichier:ligne:  prisma/seed-portfolio.ts:2131-2134,2199-2212
Reproduction:   1. P10 : 140000€ @3,80%, 240 mois, mensualité 833€. Annuité exacte=833,69€. 2. Boucle du seed (decimal.js) → p10Crd après 240 mois = 247,88€. 3. Écrit : remainingAmount=247,88 ; événement "Dernière échéance — prêt soldé" avec remainingAfter 247,88. 4. lastPaymentAppliedAt=endDate → duePaymentDates s'arrête : jamais amorti.
Effet:          Dette fantôme permanente de 247,88€ (statut ACTIVE, monthsRemaining=1, endDate passée), comptée dans totalDebtEur et la déduction IFI.
Déjà connu:     non

ID:             PAS-06
Gravité:        P3
Fichier:ligne:  app/lib/liabilities/amortization.ts:6-10,22-36 ; app/lib/liabilities/overview.ts:78-87
Reproduction:   1. monthlyRateFromAnnual → .toNumber(), annual<=0 → 0 silencieux (taux négatif = 0%). 2. estimateRemainingMonths : Math.log/division flottantes ; overview.ts : agrégats en Number. 3. Impact chiffré non établi. [NON MESURÉ]
Effet:          Écart à la doctrine Decimal.js (durée, intérêts restants, taux moyen pondéré en float) ; taux négatif absorbé sans erreur.
Déjà connu:     non
```
