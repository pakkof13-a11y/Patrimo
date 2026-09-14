# audit-journal — Journal Comptable (types tx, cascade, devise événement)

```
ID:             JOU-01
Gravité:        P1
Fichier:ligne:  app/lib/platforms/upsert.ts:189-196 ; app/lib/accounting/ledger.ts:222-224,244-246 ; app/lib/portfolio/service.ts:97-104
Reproduction:   APPORT 1000€ sur A ; TRANSFERT_CASH A→B 400€. POST /api/platforms/merge {sourceId:A,targetId:B} → la tx devient platformId=toPlatformId=B. Tout rejeu lève AccountingError SAME_PLATFORM.
Effet:          100% des lectures ledger (dashboard, positions) et 100% des createTransaction non-interactives échouent après la fusion, sans message désignant la ligne fautive. mergePlatforms ne pré-contrôle ni ne réécrit ces transferts intra-fusion.
Déjà connu:     non

ID:             JOU-02
Gravité:        P2
Fichier:ligne:  app/lib/transactions/service.ts:234-261 ; import/commit.ts:558 ; schemas.ts:133
Reproduction:   ACHAT 100 USD daté 2021-01-04, sans taux fourni (default zod "1") → resolveFx : provided.eq(1) → liveFxToEur("USD") = taux DU JOUR, écrit dans Transaction.fxRateToEur pour une transaction passée.
Effet:          Coût de revient EUR d'une écriture passée converti au taux courant. USD→EUR 2021-01≈0,815 vs 2024-01≈0,915 : ~12% d'écart sur le PRU. Contredit la doctrine fx.ts (aucun appelant n'a le droit de l'approximer), appliquée seulement aux revenus.
Déjà connu:     non

ID:             JOU-03
Gravité:        P2
Fichier:ligne:  app/api/platforms/route.ts:356-367
Reproduction:   APPORT 1000€ sur A ; TRANSFERT_CASH A→B 400€ → cash A=600€. DELETE ?id=B&force=1 → la tx (toPlatformId=B) est supprimée.
Effet:          Cash A remonte à 1000€ : +400€ fantômes sur une plateforme non supprimée. Même mécanique pour TRANSFERT_TITRE (quantité réapparaît sur A). Le 409 annonce "N transactions liées" mais pas l'effet sur la plateforme source.
Déjà connu:     non

ID:             JOU-04
Gravité:        P2
Fichier:ligne:  app/api/admin/users/route.ts:146 ; schema.prisma:131,237,300-302 (Transaction_platformId_fkey / Transaction_assetId_fkey ON DELETE RESTRICT)
Reproduction:   Utilisateur avec ≥1 Transaction. DELETE /api/admin/users?id=X → cascade User→Platform/Asset frappe la FK Restrict de Transaction.
Effet:          P2003 → 500, aucune suppression. Suppression admin impossible pour tout compte ayant écrit une ligne.
Déjà connu:     non

ID:             JOU-05
Gravité:        P2
Fichier:ligne:  app/lib/tax/fiscal-year.ts:289-325 ; portfolio/total-return.ts:339-369 ; portfolio/twr.ts:123-135 (0 occurrence de TRAVAUX)
Reproduction:   ACHAT bien 285000€ puis TRAVAUX 30000€ (coût de revient 315000€ dans ledger.ts). VENTE à 340000€. buildCumpAtSellLookup ignore TRAVAUX → CUMP 285000 → plus-value fiscale 55000€ au lieu de 25000€.
Effet:          +30000€ de plus-value fiscale surestimée ; latent surestimé de 30000€ dans twr/total-return. Le type existe et est bien traité par ledger.ts/tx-mapper.ts/class-history.ts/engine.ts ; ces 3 agrégats l'oublient. Hors périmètre strict → finance-metier/fiscal-metier.
Déjà connu:     non

ID:             JOU-06
Gravité:        P3
Fichier:ligne:  transactions/net-price.ts:88-95 ; list-query.ts:321 ; acquisition-cost.ts:72,112-114
Reproduction:   TRAVAUX cashAmount30000€, fees500€. Journal affiche 30000€ (netCashImpactEur=0→repli grossEur) ; panneau acquisition-cost affiche 30500€ (gross+fees).
Effet:          KPI "Frais" compte ces 500€ comme frais alors que ledger.ts les capitalise (pas dans totalFeesPaidEur). Écart=feesEur des TRAVAUX.
Déjà connu:     non

ID:             JOU-07
Gravité:        P3
Fichier:ligne:  transactions/list-query.ts:171-176
Reproduction:   GET /api/transactions?sortBy=netPrice sur un journal avec ACHAT/VENTE. Tri sur netCashImpactEur, stocké à 0 pour 7 types sur 15 (ACHAT,VENTE,REWARD,AIRDROP,TRANSFERT_TITRE,SPLIT,TRAVAUX).
Effet:          Tous les trades sont ex æquo à 0 ; l'ordre affiché ne correspond pas au tri demandé.
Déjà connu:     non

ID:             JOU-08
Gravité:        P3
Fichier:ligne:  transactions/service.ts:500-502,548-550,289-291
Reproduction:   DIVIDENDE avec WHT : whtEur=Number(Decimal.toString())→Math.max(0,float)→d(float).
Effet:          Float en calcul métier sur un montant écrit en base. Perte au-delà de ~16 chiffres significatifs. [NON MESURÉ] écart observable.
Déjà connu:     non

ID:             JOU-09
Gravité:        P3
Fichier:ligne:  app/lib/crypto/nft-manual-service.ts:301
Reproduction:   deleteNftItem → tx.transaction.deleteMany({where:{assetId}}) sans userId dans la clause (isolation portée par la vérification amont seulement).
Effet:          Défaut de forme, cohérence avec les 4 autres sites de suppression groupée non respectée. Pas d'exploitation démontrée.
Déjà connu:     non

ID:             JOU-10
Gravité:        P3
Fichier:ligne:  prisma/schema.prisma:306-309
Reproduction:   Aucun index sur toPlatformId ; requêtes OR:[{platformId},{toPlatformId}] et updateMany({toPlatformId}).
Effet:          Balayage de table sur la branche toPlatformId. [NON MESURÉ] coût réel (dépend du volume).
Déjà connu:     non
```
