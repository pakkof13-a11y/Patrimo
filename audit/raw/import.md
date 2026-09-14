# audit-import — CSV titres/banques/journal (hors épargne salariale)

```
ID:             IMP-01
Gravité:        P2
Fichier:Ligne:  import/commit.ts:404-410 ; map-rows.ts:1654 ; normalize.ts:452-455
Reproduction:   2 fills identiques à 10:51:03 et 10:51:47 (même ticker/qty/prix/devise). toIsoLocal perd les secondes → dedupe "à la minute" les confond → 2e ligne classée strictSkipped.
Effet:          Ligne valide silencieusement comptée en doublon, jamais dans errors[] ; stock sous-évalué. Fréquent sur fills DEX/DCA.
Déjà connu:     non

ID:             IMP-02
Gravité:        P2
Fichier:Ligne:  import/ibkr-activity.ts:272-371 (4 sites)
Reproduction:   Quantity="1,000" (milliers anglo-saxons) → Number("1,000".replace(",", ".")) = 1 (÷1000 silencieux). "1,234.5" → NaN → ligne écartée sans warning.
Effet:          Quantité divisée par 1000 ou trade supprimé sans trace ; le parseur partagé (normalize.ts::parseNumber) n'est pas utilisé ici.
Déjà connu:     non

ID:             IMP-03
Gravité:        P2
Fichier:Ligne:  import/commit.ts:558 → transactions/service.ts:234-260
Reproduction:   Import ACHAT USD daté 2021: commit passe fxRateToEur:"1" pour toute ligne → resolveFx substitue le taux DU JOUR (2026), pas le taux historique. Seuls DIVIDENDE/COUPON/LOYER/INTERET prennent le taux historique.
Effet:          Coût de revient d'un trade importé de 2021 valorisé au taux 2026 (~10% de dérive USD/EUR sur la période).
Déjà connu:     non

ID:             IMP-04
Gravité:        P2
Fichier:Ligne:  transactions/service.ts:495-504 (via import/commit.ts:547-568)
Reproduction:   Lot: L2 ACHAT 100 AAPL, L3 VENTE 100 AAPL. L2: état ledger mis à jour AVANT l'insert Prisma ; l'insert échoue (réseau/timeout) → catch → errors[L2]. L3 voit les 100 AAPL "fantômes" dans l'état en mémoire → VENTE validée et écrite.
Effet:          Journal en base avec une VENTE sans son ACHAT correspondant ; aucun rollback (chaque ligne = insert isolé, pas de transaction englobante).
Déjà connu:     non

ID:             IMP-05
Gravité:        P2
Fichier:Ligne:  api/import/commit/route.ts:33 ; import/commit.ts:523-581 ; market/fx.ts:252-254
Reproduction:   maxDuration=60s, boucle séquentielle sans checkpoint. 300 lignes DIVIDENDE USD: 1 fetch Frankfurter/ligne sans cache, timeout 3s. Fournisseur lent → lambda tuée à mi-lot.
Effet:          Écritures partielles commises, aucune réponse, aucun rapport {line,message} — l'utilisateur ne sait pas où le lot s'est arrêté.
Déjà connu:     non

ID:             IMP-06
Gravité:        P3
Fichier:Ligne:  import/map-rows.ts:290
Reproduction:   CSV Coinbase avec conversions dédoublées (expandCoinbaseConversions) : `line = idx+2` calculé sur les lignes post-expansion, pas sur le fichier source.
Effet:          errors[{line}] désigne une ligne fichier qui n'est pas la bonne (décalage +2 mesuré sur fixture Coinbase). Cohérent preview↔commit, donc pas de corruption, juste un mauvais numéro affiché.
Déjà connu:     non

ID:             IMP-07
Gravité:        P3
Fichier:Ligne:  import/commit.ts:455-506 ; api/import/preview/route.ts:82
Reproduction:   CSV 800 lignes, erreur en ligne 650. Preview tronque à 500 lignes → invisible ; commit filtre les lignes "error" en amont → jamais dans errors[].
Effet:          Erreurs de mapping (date/type/qty invalides) absentes de tout rapport au-delà de l'aperçu tronqué.
Déjà connu:     non

ID:             IMP-08
Gravité:        P3
Fichier:Ligne:  import/map-rows.ts:1248-1252
Reproduction:   Colonne frais = "N/A"/"--" → parseNumber null → `?? 0`, aucun warning, status "ok".
Effet:          UNKNOWN=0 sur les frais sans trace ; prix de revient minoré.
Déjà connu:     non

ID:             IMP-09
Gravité:        P3
Fichier:Ligne:  import/map-rows.ts:1547-1548,340 ; ibkr-activity.ts:297
Reproduction:   Coinbase "BTC-USDC" → currencyRaw slice(0,3)="USD" sans warning ; format générique sans colonne devise → repli "EUR" silencieux.
Effet:          Devise inconnue convertie silencieusement en EUR ou stablecoin en fiat.
Déjà connu:     non

ID:             IMP-10
Gravité:        P3
Fichier:Ligne:  import/commit.ts:358-364 (doc :299-300 "Ne crée rien")
Reproduction:   POST /api/import/analyze avec un nouveau nom de plateforme → findOrCreatePlatform crée la plateforme en base malgré la doc "sans écriture".
Effet:          Plateforme orpheline créée si l'utilisateur annule l'import après analyse.
Déjà connu:     non

ID:             IMP-11
Gravité:        P3
Fichier:Ligne:  import/commit.ts:540-547
Reproduction:   ACHAT avec devise valide (3 lettres) mais inconnue du fournisseur FX → l'Asset est créé (transaction Prisma propre) puis la Transaction échoue (FX_RATE_UNKNOWN).
Effet:          Actif créé sans transaction associée, compté dans assetsCreated, sans rollback entre les deux écritures.
Déjà connu:     non

ID:             IMP-12
Gravité:        P3
Fichier:Ligne:  ibkr-activity.ts (4 sites), hyperliquid-fills.ts:139, paradex-fills.ts (3 sites)
Reproduction:   9 sites `Number(String(x).replace(...))` ad hoc dans 4 fichiers, contournant parseNumber partagé (pas de gestion milliers/parenthèses négatives/symbole monétaire).
Effet:          Comportement de parsing incohérent selon le format source ; voir IMP-02 pour l'impact concret mesuré.
Déjà connu:     partiellement (audit 1: parseNumber partagé identifié, sites ad hoc import non listés)

ID:             IMP-13
Gravité:        P3
Fichier:Ligne:  import/normalize.ts:126-188
Reproduction:   Fichier EN sans signal décisif de séparateur décimal → inferDecimalSeparator rend undefined → repli FR par défaut.
Effet:          ÷1000 silencieux possible sur un fichier EN sans décimales apparentes.
Déjà connu:     oui (limitation documentée en commentaire)

ID:             IMP-14
Gravité:        P3
Fichier:Ligne:  import/map-rows.ts:1281-1661
Reproduction:   cashAmount = qty×unitPrice, frais Saxo = round(ecart×1e6)/1e6 en float, écrits comme montants Decimal.
Effet:          Artefacts flottants ("0.30000000000000004") écrits en base comme montants métier — violation Decimal.js.
Déjà connu:     partiellement (audit 1: "float dans un module cash", périmètre banques)

ID:             IMP-15
Gravité:        P3
Fichier:Ligne:  import/commit.ts:559 ; api/import/commit/route.ts:109
Reproduction:   Mode legacy `rows`: draft status "ok" avec occurredAt null, non revalidé côté serveur → commit écrit new Date().toISOString().
Effet:          Date d'opération fabriquée (aujourd'hui) pour une ligne sans date réelle ; le chemin csvText est protégé (status "error"), pas le chemin rows.
Déjà connu:     non
```
