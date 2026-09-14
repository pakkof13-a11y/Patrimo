# audit-fiscal — AV, PEA, IFI, PFU, dates fail-open

```
ID:             FIS-01
Gravité:        P2
Fichier:ligne:  app/lib/real-estate/tax/ifi.ts:144-178
Reproduction:   computeIfi([{grossValueEur:"2000000"},{grossValueEur:"500000",deductibleDebtEur:"100000"}]) → net 2400000, liable=true, IFI 10200,00€. Remplacer une valeur par "NaN" : d("NaN") accepté (decimal.ts:21, pas de garde isFinite), grossTaxable/netTaxable → NaN, `netTaxable.gte(1_300_000)`=false → liable=false, taxEur=0. UI (tax/overview.ts:182-191) affiche "Non redevable".
Effet:          Une ligne illisible éteint l'IFI de TOUT le foyer : 10200€ → 0€ présenté comme "Non redevable" au lieu d'un refus. Chemin de données réel produisant "NaN" : [NON MESURÉ].
Déjà connu:     non

ID:             FIS-02
Gravité:        P2
Fichier:ligne:  app/lib/real-estate/tax/ifi.ts:155-165 (service.ts:279-291 toIfiAssets)
Reproduction:   computeIfi([{RP grossValueEur:1000000, isPrimaryResidence:true, deductibleDebtEur:900000},{grossValueEur:1600000}]) → ligne RP : taxable 700000, dette 900000, netValueEur=−200000 ; assiette nette 1400000 ; IFI 3200,00€.
Effet:          La dette adossée à la RP est déduite au-delà de la valeur imposable de la RP (abattement 30% appliqué à l'actif, pas à la dette) et le surplus réduit les autres biens. Avec dette RP plafonnée à la valeur imposable : assiette 1600000 → IFI 4600€ ; sous-évaluation 1400€. Aucun plafonnement art.974 IV non plus. Règle en vigueur à confirmer avant correction.
Déjà connu:     non (D46 = devise de la dette, distinct)

ID:             FIS-03
Gravité:        P3
Fichier:ligne:  app/lib/real-estate/tax/ifi.ts:178 (`netTaxable.gte(IFI_THRESHOLD)`)
Reproduction:   computeIfi([{grossValueEur:1300000}]) → liable=true, taxEur 1250,00€ (2500 − décote 1250).
Effet:          Art.964 CGI : redevable si patrimoine "supérieur à" 1300000€. À l'euro exact, l'app annonce 1250€ d'IFI non dû (défavorable, pas fail-open). Test ifi.test.ts:141 fige ce comportement.
Déjà connu:     non

ID:             FIS-04
Gravité:        P3
Fichier:ligne:  app/lib/real-estate/tax/capital-gain.ts:111-118 ; components/real-estate/capital-gain-simulator.tsx:74
Reproduction:   Simulateur PV : vider "Date de cession" → new Date("") → holdingYearsBetween(valide, Invalid)=NaN (aucun garde). computeCapitalGain(400000/200000, achat 2015-01-01, vente invalide) → irAbat NaN, totalTax NaN, exempt=false (référence date valide : 59154,40€).
Effet:          Affichage "Détention NaN ans", "Impôt total NaN€". Pas favorable (NaN visible), mais aucun refus explicite. Accessoirement holdingYearsBetween lit getFullYear/getMonth/getDate (fuseau navigateur) vs fiscal.ts AV migré en jour civil Paris ; dérive possible d'un jour [NON MESURÉ en prod].
Déjà connu:     non

ID:             FIS-05
Gravité:        P3
Fichier:ligne:  app/lib/tax/movable-assets.ts:201 (`toDate(input.soldAt) ?? new Date()`)
Reproduction:   computeMovableSaleTax({PRECIOUS_METAL, prix20000, revient10000, acquiredAt "2010-06-01", soldAt "", hasInvoice:true}) → holdingYears16, abattement70%, PV1128€ vs forfait2300€, recommandé PLUS_VALUE — sans erreur. soldAt "2040-01-01" (futur) → 29 ans, abattement100%, exempt=true ; aucun garde "date future".
Effet:          Une date de cession illisible est remplacée en silence par "aujourd'hui" et produit un régime au lieu d'un refus. Atteignable via le simulateur métaux ; l'enregistrement serveur refuse l'illisible mais accepte le futur.
Déjà connu:     non

ID:             FIS-06
Gravité:        P3
Fichier:ligne:  app/lib/tax/fiscal-year.ts:102-112 (parisYear), :159-160,270-276
Reproduction:   ACHAT10×100(2025) + VENTE10×200 occurredAt "garbage" ; buildFiscalYearReport(2026) → sellCount0, unresolvedSellCount0, realized0, PFU0€. Même journal avec date valide → realized1000€, PFU314€.
Effet:          Intl.format lève sur Invalid Date → catch → getUTCFullYear()=NaN → la vente disparaît sans compteur ni signal ; comparateur de tri CUMP rend NaN. Chemin réel (fiscal-year-service.ts:48 passe des ISO Prisma toujours valides) → [NON MESURÉ] sur données réelles ; défaut moteur seulement.
Déjà connu:     non

ID:             FIS-07
Gravité:        P3
Fichier:ligne:  app/api/life-insurance/route.ts:133-137,246-252 (checkPremiumsSplit sans openDate) ; app/lib/schemas.ts:462
Reproduction:   Créer un contrat openDate 2020-01-01 avec premiumsBefore2017Eur 100000, premiumsAfter2017Eur 0 → accepté. Après 8 ans, rachat 10000€ de gains imposables → beforeShare=1 → 100% à 7,5% = 750€ au lieu de 12,8% = 1280€.
Effet:          Incohérence date/versements non refusée : un contrat né après le 27/09/2017 peut porter des primes "pré-réforme" → PFU sous-évalué de 530€ sur cet exemple. Saisie utilisateur (pas illisible), donc P3.
Déjà connu:     non
```

Vérifié sans constat (fail-safe confirmé, non re-signalé) : `contractAge`/`fullMonthsBetween` sur date illisible/future (D44), `peaMaturityStatus` (NaN → isMatured=false), `parseOpenDate` PEA refuse futur/illisible, `createPreciousMetalSale` refuse soldAt illisible, dette IFI en devise (D46).
