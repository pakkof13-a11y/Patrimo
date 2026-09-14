# audit-immo — Immobilier (occupancy, cash-flow, fiche non éditable)

```
ID:             IMM-01
Gravité:        P1
Fichier:ligne:  app/api/real-estate/properties/route.ts:199-254 (seul POST) ; .../characteristics/route.ts:23-71 ; .../fiscal/route.ts:15-31 ; property-panel.tsx:1610-1614,404-407
Reproduction:   POST /properties (LOCATIF_NU, sans loyer, sans adresse). Aucune route PATCH n'accepte monthlyRentEur/monthlyChargesEur/annualPropertyTaxEur/occupancyRatePct/rentDay/rentalStartDate/usage/propertyType/livingAreaM2/addressLine/liabilityId. Fiche : "Loyer non renseigné" et "Adresse non localisée" sans champ pour le faire.
Effet:          Après création, usage/type/surface/adresse/loyer/charges/TF/occupation/dates de bail/prêt rattaché sont figés à vie. Seuls DPE/copro/TH, régime fiscal, valeur sont modifiables ; le nom via PATCH générique /api/assets.
Déjà connu:     non

ID:             IMM-02
Gravité:        P1
Fichier:ligne:  app/lib/real-estate/property-views.ts:176-183,191-196 ; constants.ts:393-413 ; property-panel.tsx:623-632 ; property-create-form.tsx:605-608
Reproduction:   Bien ownershipSharePct=50, prix 285000, frais 12000, loyer 1250 ("bien entier"), charges 180, TF 1420. costBasis de la part=154500. netYield=(15000−2160−1420)/154500=7,39% ; monthlyCashFlowEur=952€.
Effet:          Numérateur au bien entier, dénominateur à la quote-part : rendement net 2× surestimé pour une indivision à 50% (7,39% au lieu de 3,70%), cash-flow 952€ affiché pour un porteur qui en encaisse 476. grossYieldPct est le seul ratio homogène.
Déjà connu:     non

ID:             IMM-03
Gravité:        P2
Fichier:ligne:  app/lib/real-estate/rent-schedule.ts:245-251 (curseur) ; amortization.ts:137-139,156 ; rent-schedule-panel.tsx:68-70,90-94
Reproduction:   Bien seed (rentDay5, loyer1250, lastRentAppliedAt null, start−900j). Décocher le 5 juillet (retard locataire), confirmer → curseur=5 sept. GET rent-schedule : duePaymentDates repart du mois du curseur, le 5 juillet n'est plus jamais proposé.
Effet:          1250€ de loyer (ou plus) disparaissent silencieusement des propositions, à rebours de l'engagement documenté (l.16-18 : "une échéance ignorée reste proposée au passage suivant").
Déjà connu:     non

ID:             IMM-04
Gravité:        P2
Fichier:ligne:  property-panel.tsx:379 (force:true, apply:true) ; valuation.ts:312-314,392-410 ; .../valuation/route.ts:52-54
Reproduction:   Bien MANUAL à 312000. Clic "Estimer depuis les ventes réelles" → revalueFromDvf(force) passe le garde-fou ; apply≠false → recordValuation écrase manualPrice par la médiane DVF sans changer valuationMode.
Effet:          La valeur saisie est remplacée en un clic malgré le texte "Valeur saisie — non écrasée par l'estimation" juste au-dessus du bouton. Mode reste MANUAL, l'écran continue d'affirmer que la valeur est celle de l'utilisateur.
Déjà connu:     non

ID:             IMM-05
Gravité:        P3
Fichier:ligne:  property-views.ts:164,180 ; property-panel.tsx:611-613,627-629
Reproduction:   buildPropertyView(occupancyRatePct: 0 as unknown as string) → monthlyCashFlowEur=0 mais grossYieldPct=6% (occupation lue "absente"→100%).
Effet:          Le correctif 661cd04 (occupancyInput) n'a été appliqué qu'au cash-flow ; les rendements gardent le test de vérité qui traite un 0 numérique comme "non saisi". Non atteignable aujourd'hui via l'API (chaîne "0" truthy). [NON MESURÉ en production]
Déjà connu:     partiellement (661cd04 ne couvre que le cash-flow)

ID:             IMM-06
Gravité:        P3
Fichier:ligne:  property-views.ts:193-196 vs 303-309 ; real-estate-tab.tsx:296-301,433-440
Reproduction:   Bien LOCATIF_NU sans loyer, charges 180€/mois, TF 1420. monthlyCashFlowEur=null (exclu du KPI) ; annualChargesEur+=3580.
Effet:          Deux cash-flows sur le même écran : KPI "—" (0), onglet Loyers "−3580€".
Déjà connu:     non

ID:             IMM-07
Gravité:        P3
Fichier:ligne:  properties/route.ts:22-26,59-62 ; characteristics/route.ts:17-21,59-63 ; schema.prisma:584 (Decimal(5,2))
Reproduction:   monthlyChargesEur "-100" accepté ; annualHabitationTaxEur "-800" accepté ; occupancyRatePct "1000" → Prisma refuse (Decimal max 999,99) → 500 au lieu de 400.
Effet:          Charges/taxes négatives gonflent cash-flow et rendement net ; occupation≥1000 renvoie une 500 non explicite.
Déjà connu:     non

ID:             IMM-08
Gravité:        P3
Fichier:ligne:  valuation.ts:392-397,432-459
Reproduction:   Bien DVF_AUTO dont l'estimation ne bouge pas (<1€) : "same-value" ne met pas à jour lastValuedAt → jugé périmé à chaque passage → requêtes Haversine rejouées à chaque cron. [NON MESURÉ]
Effet:          Coût réseau/DB répété sans information nouvelle.
Déjà connu:     non

ID:             IMM-09
Gravité:        P3
Fichier:ligne:  .../fiscal/route.ts:29,133-135
Reproduction:   PATCH fiscal {schemeBaseEur:"abc"} → z.string() sans regex → Prisma Decimal invalide → catch → 500 au lieu de 400.
Effet:          Erreur de saisie rendue comme panne serveur.
Déjà connu:     non
```
