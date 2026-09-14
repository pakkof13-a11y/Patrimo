# audit-fx — app/lib/market/fx.ts, accounting/fx.ts, resolveFx, fx-pnl

Note de périmètre : `app/lib/fx/**` n'existe pas à ce SHA ; module réel audité : `app/lib/market/fx.ts`, `app/lib/accounting/fx.ts`, `app/api/fx/route.ts`, `resolveFx` (transactions/service.ts), `app/lib/portfolio/fx-pnl.ts` + `fx-pnl-panel.tsx`. « D42 » n'existe pas dans le dépôt (D39-D41/D44/D46 si).

```
ID:             FX-01
Gravité:        P2
Fichier:Ligne:  components/assets/fx-pnl-panel.tsx:11-54 ; asset-workspace-sections.tsx:803-819 ; portfolio/fx-pnl.ts:127-156
Reproduction:   Actif USD, cotation 230 USD/195,50€ (fx 0,85). Achat 10 saisi en EUR: unitPrice 150€, fxRateToEur=1. LedgerLeg ne porte pas `currency`: buyPriceNative=150(EUR) comparé à priceNowNative=230(USD).
Effet:          Total juste (+455€) mais décomposition affichée: "Effet change −225€" pour un achat payé en euros — l'identité "coût et valeur même devise avant P&L" est violée dans le split, pas dans le total.
Déjà connu:     non

ID:             FX-02
Gravité:        P2
Fichier:Ligne:  market/providers/yahoo.ts:61-64 ; market/symbol.ts:57
Reproduction:   Actif coté à Londres (VOD.L). quote.currency="GBp" (pence) → .toUpperCase()="GBP" → toEurAmount traite 75.5 pence comme 75.5 livres.
Effet:          priceEur ×100 sur toute action LSE en pence, status "OK" (pas d'erreur). L'import CSV corrige déjà GBX ; le chemin cotation live ne le fait pas.
Déjà connu:     non

ID:             FX-03
Gravité:        P2
Fichier:Ligne:  market/fx.ts:96-127 (isFallback jamais exposé) ; api/fx/route.ts:52-64 ; transaction-modal.tsx:340-370
Reproduction:   Frankfurter injoignable → getEurRates rend la table statique, même forme qu'un taux réel. GET /api/fx → 200 sans indication. Le modal écrit ce taux comme "constaté".
Effet:          Un taux de repli (table statique) est enregistré/affiché comme un taux réel constaté, sans distinction en base ni à l'écran. Écart mesuré possible de plusieurs % selon la dérive réelle.
Déjà connu:     partiellement (le repli est assumé par design, son invisibilité ne l'est pas)

ID:             FX-04
Gravité:        P2
Fichier:Ligne:  market/fx.ts:250-266 (fxRateToEurOnDate) ; transactions/service.ts:206-231 ; import/commit.ts:557-558
Reproduction:   Import de 100 DIVIDENDE USD: fxRateToEurOnDate sans cache/retry, 1 fetch par ligne (3s de budget), séquentiel. Un 429/503/timeout tombe dans le même null qu'un 404.
Effet:          Un refus fournisseur (429) est traité comme "date non documentée" — la ligne est refusée avec "renseignez-le manuellement" alors que le taux existe réellement. Un burst de 429 refuse en cascade tout le lot.
Déjà connu:     non

ID:             FX-05
Gravité:        P2
Fichier:Ligne:  market/fx.ts:43-171 (FALLBACK=5 devises) ; portfolio/service.ts:340, asset-values.ts:69, historical/load.ts:315, price-history.ts:756 (sans garde)
Reproduction:   Actif currency="SEK" (hors table de repli), Frankfurter en échec (cold start) → convertToEurSync lève FxRateUnknownError dans getHoldings.
Effet:          Tout le portefeuille devient illisible (500) le temps de la panne, pour une seule ligne en devise hors table — même motif qu'ES-02 (audit 1) mais sur les holdings, pas l'épargne salariale.
Déjà connu:     partiellement (ES-02 couvrait un autre périmètre)

ID:             FX-06
Gravité:        P3
Fichier:Ligne:  market/fx.ts:252-262 ; api/fx/route.ts:48
Reproduction:   GET /api/fx avec une date future → Frankfurter renvoie le dernier taux disponible, étiqueté "frankfurter-historical".
Effet:          Un revenu à échéance future persiste un taux daté comme "historique" alors qu'il ne l'est pas encore.
Déjà connu:     non

ID:             FX-07
Gravité:        P3
Fichier:Ligne:  market/fx.ts:245-248
Reproduction:   fxRateToEurOnDate avec un Date en heure locale (minuit Paris, lundi) → toISOString bascule au dimanche précédent → Frankfurter sert le vendredi.
Effet:          Taux d'un jour ouvré antérieur pour tout appelant passant un Date en heure locale (pas les chaînes YYYY-MM-DD du modal).
Déjà connu:     non

ID:             FX-08
Gravité:        P3
Fichier:Ligne:  transactions/net-price.ts:68, acquisition-cost.ts:94, twr.ts:82-95, total-return.ts:165-265, tax/fiscal-year.ts:163-286, fx-pnl-panel.tsx:46, transactions/service.ts:113
Reproduction:   Transaction héritée avec fxRateToEur=0/non-numérique (impossible à l'écriture, possible sur données legacy) → num(fx) || 1.
Effet:          9 lecteurs retombent silencieusement à parité (1) — le repli que fx.ts a éliminé côté résolution survit côté lecture.
Déjà connu:     non

ID:             FX-09
Gravité:        P3
Fichier:Ligne:  portfolio/fx-pnl.ts:55-156
Reproduction:   2 achats à des taux FX différents, vente partielle (CUMP consomme la moitié). weightedBuyFx pondère TOUTES les unités achetées, pas seulement celles restant en position.
Effet:          Le split prix/change est recalé au total (donc arithmétiquement cohérent) mais la répartition affichée est approximative, rendue avec estimated=false (pas signalée comme approximation).
Déjà connu:     non

ID:             FX-10
Gravité:        P3
Fichier:Ligne:  asset-workspace-sections.tsx:809-818 ; portfolio/service.ts:344-346
Reproduction:   Actif USD sans cotation (ERROR/supprimée) → priceNative=avgCost (EUR) passé comme prix natif USD.
Effet:          Un montant EUR est publié sous l'étiquette de la devise de l'actif — mélange EUR/USD comme FX-01 si la valeur diverge du coût.
Déjà connu:     non
```

Vérifié sans constat : manualPrice cohérent en devise native sur 8 sites ; syncs Zerion/Solana/DeFi écrivent en EUR sur des actifs EUR (cohérent) ; accounting/fx.ts sans défaut ; writeFx/resolveFx refusent l'inconnu ; cache getEurRates conforme aux tests. JOU-02 (taux du jour sur transaction passée) déjà signalé audit 1, non re-signalé.
