# audit-api — Routes portfolio, to, history[] vs E2E

```
ID:             API-01
Gravité:        P1
Fichier:ligne:  e2e/api-health.spec.ts:26 ; app/api/portfolio/route.ts:73-77
Reproduction:   GET /api/portfolio?base=EUR rend {summary,allocation,baseCurrency} depuis 25a8265. Spec (dernière modif ebe5dac) : expect(Array.isArray(p.history)).toBeTruthy() → p.history===undefined → rouge.
Effet:          1 test "holdings, portfolio et transactions répondent" rouge à chaque run CI. Assertion morte sur un champ retiré du contrat ; les assertions suivantes (transactions) ne s'exécutent plus.
Déjà connu:     non

ID:             API-02
Gravité:        P1
Fichier:ligne:  e2e/evolution-account.spec.ts:35-39,59-67,96-101,106-109 ; e2e/evolution-envelope.spec.ts:24-29,82-84,123-124,137,154-157
Reproduction:   Les deux specs lisent body.history ?? [] sur GET /api/portfolio → []. evolution-account : 4 tests rouges/TypeError sur undefined. evolution-envelope : idem (byAssetClassAndEnvelopeBase sur undefined). Jamais réalignées sur daily-nav (contrairement à coherence-totaux.spec.ts).
Effet:          8 tests rouges à chaque run pour une raison de contrat, pas de métier. Les invariants qu'ils portaient (somme des classes=brut au centime, flux par classe=flux externes, UNKNOWN≠0) ne sont plus vérifiés nulle part contre l'API.
Déjà connu:     non

ID:             API-03
Gravité:        P2
Fichier:ligne:  e2e/evolution-envelope.spec.ts:135-143
Reproduction:   serie(page)→[] (cf API-02). for(const p of [].slice(-5)) → 0 itération → aucun expect exécuté → test VERT.
Effet:          Assertion morte silencieuse : le test "aucune classe hors titres ne porte de croisement" passe sans rien prouver, contrairement aux 8 autres (API-02) qui échouent visiblement.
Déjà connu:     non

ID:             API-04
Gravité:        P3
Fichier:ligne:  e2e/evolution-envelope.spec.ts:250-261
Reproduction:   Test "la performance disparaît dès qu'une enveloppe est choisie" : selectOption+click, aucun expect.
Effet:          Test vert par construction ; l'invariant annoncé n'est pas vérifié.
Déjà connu:     non

ID:             API-05
Gravité:        P3
Fichier:ligne:  app/api/portfolio/daily-nav/route.ts:123-131
Reproduction:   J=parisDayKey(now). GET ?from=J&to=J → to plafonné à J-1, puis from>to → 400 "from postérieur à to". GET ?to=J seul → 200 (borne plafonnée).
Effet:          Message d'erreur faux (from n'est pas postérieur au to demandé). UI non touchée. [NON MESURÉ]
Déjà connu:     non

ID:             API-06
Gravité:        P3
Fichier:ligne:  app/api/benchmark/route.ts:71-81 vs daily-nav/route.ts:88-124
Reproduction:   daily-nav : to strict YYYY-MM-DD, 400 sinon, plafonné. benchmark : to via new Date(toRaw) — "2026-1-5" accepté, "2200-01-01" accepté et transmis à Yahoo.
Effet:          Validation de `to` incohérente entre routes sœurs ; pas de plafond haut côté benchmark. Impact fonctionnel nul sur l'UI actuelle. [NON MESURÉ]
Déjà connu:     non

ID:             API-07
Gravité:        P3
Fichier:ligne:  app/api/portfolio/class-pnl/route.ts:28-34
Reproduction:   GET ?range=zzz → 200 {range:"zzz", fromDay:<J-30>, toDay:<J>} : repli silencieux sur 1m mais écho range:"zzz".
Effet:          La réponse annonce une plage qu'elle n'a pas servie. Contraste avec daily-nav (400 sur scope inconnu).
Déjà connu:     non (NAV-01 couvre toDay=aujourd'hui sur cette route, pas ce point)

ID:             API-08
Gravité:        P3
Fichier:ligne:  app/hooks/use-portfolio-queries.ts:34-44 ; app/lib/ui/invalidate-portfolio.ts:33
Reproduction:   usePortfolioHistoryQuery : 0 appelant dans app/ et components/ (grep). invalidate-portfolio.ts:33 invalide encore la clé ["portfolio-history"].
Effet:          Appelant mort du contrat retiré ; le nom du hook réintroduit la promesse d'un `history` que /api/portfolio ne tient plus. Aucun effet runtime.
Déjà connu:     partiellement
```

Vérifié sans constat : aucune route sous app/api/portfolio/** ne rend `history[]` ; les clés `history` hors périmètre (real-estate valuation, tax/fiscal-year) sont des contrats propres, non une réintroduction de la série patrimoniale.
