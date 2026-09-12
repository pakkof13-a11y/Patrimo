# audit-alternatifs — Actifs Alternatifs (art, crowdfunding, fusion manches)

```
ID:             ALT-01
Gravité:        P2
Fichier:ligne:  app/lib/alternatives/tangibles.ts:479-480 ; tangible-valuations.ts:97 ; aucun consommateur front de /api/tangibles/[id]/valuations
Reproduction:   Créer un tangible, appraisalValue=15000, appraisalDate=2023-05-01, estimatedValue=15000. GET valuations→[] ; timeline.currentValueEur=prix d'achat, pnlEur=0. Le moteur historique date estimatedValue à updatedAt.
Effet:          Le module "constats datés" est inatteignable depuis l'UI ; l'expertise saisie sur la fiche n'alimente jamais l'historique. Date qui fait foi = updatedAt, pas appraisalDate. Même chose pour PE (aucune route API).
Déjà connu:     partiellement (commentaires reconnaissent le proxy ; absence de pont/UI non documentée)

ID:             ALT-02
Gravité:        P2
Fichier:ligne:  tangibles.ts:209-212 (mapRow),:312 (summarizeTangibles) vs consolidated.ts:254-256
Reproduction:   Tangible purchasePrice=10000, acquisitionFees=1500, estimatedValue=12000. tangibles.ts : unrealizedPnl=+2000(+20%). consolidated.ts : investedEur=11500, pnlEur=+500(+4,35%).
Effet:          Onglet Tangibles affiche +2000€ quand la vue d'ensemble affiche +500€ pour la même ligne ; écart = frais d'acquisition. Métaux incluent bien les frais → règle incohérente entre poches.
Déjà connu:     non

ID:             ALT-03
Gravité:        P2
Fichier:ligne:  precious-metals.ts:172-173 ; tangibles.ts:312-313 ; private-equity.ts:153-154 ; crowdlending.ts:213-219 (sommes natives sans FX)
Reproduction:   Deux lots métaux : 10000 EUR et 10000 USD, USD/EUR=1,10. summary.totalValue="20000.00" affiché "20000€". portfolio.ts (converti) → metalsEur=19090,91.
Effet:          KPI de poche en "EUR" faux de 909€ (4,5%) dès qu'une ligne est en devise ; idem P&L latent, totalCost. Diverge du bundle summary rendu dans la même réponse HTTP.
Déjà connu:     non (la correction consolidated.ts ne couvre pas les summaries par poche)

ID:             ALT-04
Gravité:        P2
Fichier:ligne:  alternatives-tab.tsx:432,435 ; alternatives-panel.tsx:210,223,236,249,258 (consommateurs de consolidated.ts:67-68)
Reproduction:   PE currentNav=10000 USD, rate 1,10 → valueEur=9090,91 (EUR), currency="USD" conservé. UI : formatCurrency("9090.91","USD") → "$9090,91".
Effet:          Un montant déjà converti en EUR est étiqueté dans la devise native : ni le chiffre USD ni l'étiquette EUR. Erreur = facteur FX (9%) sur valeur, investi et résultat du panneau.
Déjà connu:     non

ID:             ALT-05
Gravité:        P2
Fichier:ligne:  crowdlending.ts:73-81 (effectiveRemainingCapital ne met à 0 que REPAID) et :219-220
Reproduction:   Prêt status=DEFAULT, capitalInvested=10000, remainingCapital=0. mapRow : effectiveRemainingCapital="10000.00" → UI "10000€ dû". consolidated.ts/portfolio.ts/historical : 0 (exclu).
Effet:          Un prêt en défaut affiche un capital "restant dû" plein dans l'onglet alors que les 3 autres calculs le valorisent 0 ; remainingCapitalTotal surestimé de 10000 par prêt en défaut. Distinct de FIN-04 (qui porte sur allocation-by-venue.ts).
Déjà connu:     non

ID:             ALT-06
Gravité:        P3
Fichier:ligne:  tangible-valuations.ts:144-147,187-190 (estimatedValue←valueEur sans conversion)
Reproduction:   Tangible currency=USD, POST valuation valueEur=10000 (EUR par schéma). estimatedValue=10000 "USD" → converti ensuite → 9090,91 EUR, alors qu'un autre point de lecture lit la même valuation à 10000 EUR.
Effet:          Écart FX entre valeur courante et dernier point d'historique pour un objet en devise. Latent tant qu'aucune UI n'appelle la route (cf. ALT-01).
Déjà connu:     non

ID:             ALT-07
Gravité:        P3
Fichier:ligne:  private-equity.ts:162,181 (avgMoic=NAV/investi, totalPnl=NAV−investi, distributions ignorées) vs :110,125 (moic ligne=TVPI)
Reproduction:   1 ligne : investi=10000, NAV=5000, distributionsReceived=8000. Ligne : moic=1,30, tvpi=1,3. Summary : totalPnl=−5000, avgMoic=0,5.
Effet:          "P&L latent : −5000€" sur une position qui a déjà rendu 8000 et vaut encore 5000. Tableau et KPI de la même page divergent (1,30 vs 0,50).
Déjà connu:     non (test alternatives.test.ts:298 fige avgMoic=NAV/investi)

ID:             ALT-08
Gravité:        P3
Fichier:ligne:  precious-metals.ts:444-463 (create sale puis decrementLot hors transaction)
Reproduction:   createPreciousMetalSale : si updateMany échoue après create, la cession existe et le lot reste entier. [NON MESURÉ] — chemin d'échec, pas reproduit.
Effet:          Métal compté deux fois (lot + cession) jusqu'à correction manuelle.
Déjà connu:     non

ID:             ALT-09
Gravité:        P3
Fichier:ligne:  app/lib/tangibles/valuation-history.ts:129-134
Reproduction:   points[points.length-1] inclut PURCHASE. Sans valuation : currentValueEur=prix+frais, pnlEur=0. deleteValuation remet estimatedValue=purchasePrice (sans frais).
Effet:          Pour un tangible sans constat daté, timeline et fiche diffèrent du montant des frais. Sans effet UI tant qu'ALT-01 subsiste.
Déjà connu:     non
```

Vérifié sans constat : aucun montant rond codé en dur ("45k") dans le périmètre (seuls 45_000 sont des timeouts/cooldowns hors périmètre) ; aucune catégorie ART/collectible désactivée (ART est dans TANGIBLE_CATEGORIES, rendue normalement).
