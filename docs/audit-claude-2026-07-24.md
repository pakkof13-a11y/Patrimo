# Audit Patrimo — 2026-07-24

Passe d'audit technique menée sur `claude/patrimo-repo-cleanup-06wxab`
(rebasée sur `main` @ `0bfd3bf`).

Portée réellement couverte, correctifs appliqués, et — tout aussi important —
ce qui **n'a pas** été audité dans cette passe.

---

## 1. Périmètre réellement audité

| Domaine | Profondeur | Verdict |
|---|---|---|
| Isolation multi-tenant (`userId`) | Exhaustif — 51 routes API + requêtes par id | ✅ Sain |
| Comptabilité CUMP (`app/lib/accounting`) | Lecture complète | ✅ Sain |
| Fiscalité française (`app/lib/tax`) | Lecture complète | ❌ 1 bug matériel corrigé |
| Réponses d'erreur des routes API | Exhaustif — 51 routes | ❌ Fuite d'infos corrigée |
| Lint / typecheck / tests | Exhaustif | ❌ 2 erreurs masquées corrigées |
| Arithmétique monétaire (Decimal vs float) | Ciblé par grep | ❌ 1 accumulation float corrigée |
| Accessibilité des modales | Lecture du primitif partagé | ✅ Sain (très bon niveau) |
| Validation Zod des routes mutantes | Exhaustif | ✅ Sain |
| Requêtes N+1 | Ciblé par grep | ⚠️ Acceptable (voir §4) |
| **Non audité** | — | Voir §5 |

---

## 2. Correctifs appliqués

### 2.1 Fiscalité — ventes sans prix de revient comptées comme 100 % de plus-value

**Sévérité : élevée** (chiffre fiscal faux, dans le sens qui gonfle l'impôt estimé).

`buildCumpAtSellLookup` retombait sur un CUMP de `0` quand une vente ne
trouvait aucun lot d'achat tracé (`assetId × platformId`) :

```ts
const cump = q0 > 1e-12 ? c0 / q0 : 0;
if (tx.id) realizedCump.set(tx.id, cump);   // 0 enregistré comme un vrai CUMP
```

Conséquence : l'intégralité du produit de cession était comptée en plus-value.
Cas nominal de déclenchement — un portefeuille importé dont l'historique
d'achat précède l'import : le PFU estimé pouvait être surévalué d'un ordre de
grandeur.

**Correctif** — le CUMP n'est enregistré que si une quantité est réellement
tracée sur le lot. Sinon la vente est marquée « prix de revient inconnu »,
comptée pour 0 €, et **signalée** :

- `FiscalEnvelopeBucket.unresolvedSellCount` (par enveloppe)
- `FiscalYearReport.totals.unresolvedSellCount` (global)
- UI : encart d'avertissement + badge « Partiel » sur le réalisé de chaque
  enveloppe concernée

Le rapport est désormais **sous-évalué et explicite** plutôt que surévalué et
silencieux — le bon compromis pour un écran d'estimation fiscale.

Cas volontairement préservé : un `REWARD` / `AIRDROP` garde un CUMP de 0
légitime, puisque sa quantité *est* tracée (réception gratuite).

Tests : `tests/unit/fiscal-unresolved-cost-basis.test.ts` (4 cas, dont
l'isolation du lot par plateforme).

### 2.2 API — fuite de détails Prisma vers le client

**Sévérité : moyenne** (divulgation d'informations).

23 routes renvoyaient `e instanceof Error ? e.message : "..."`. C'est le bon
comportement pour les erreurs **métier** (la couche service lève des messages
rédigés pour l'utilisateur : « Quantité insuffisante… »), mais la même branche
laissait passer les erreurs **d'infrastructure** : une erreur Prisma expose
noms de modèles, de colonnes et de contraintes ; une erreur d'initialisation
expose la cible de connexion.

**Correctif** — `app/lib/api/error-response.ts` :

- `clientErrorMessage(e, fallback)` — conserve le message des `AccountingError`
  et des `Error` volontaires ; substitue le libellé générique pour toute erreur
  Prisma.
- `clientErrorStatus(e)` — 400 pour une violation de règle métier, 500 sinon.
- `serverErrorDetail(e)` — détail complet, réservé aux logs serveur.

Appliqué aux 23 routes, **sauf** deux emplacements où le détail brut est
l'intention : le log serveur de `/api/benchmark` et le `dbError` de
`/api/health` (déjà borné au dev local).

Tests : `tests/unit/api-error-response.test.ts` (6 cas).

### 2.3 Lint — 2 erreurs que la CI masquait

Le job CI lint est en `continue-on-error: true` : les deux erreurs partaient
en production sans signal.

- `use-server-now.ts` — `setState` synchrone dans un effet (rendus en cascade),
  puis `Date.now()` impur pendant le rendu après une première correction.
  L'horloge étant une **source externe mutable**, elle est désormais exposée via
  `useSyncExternalStore` : les effets ne font que pousser vers le store. Les deux
  reproches tombent, et l'intervalle s'arrête au départ du dernier abonné.
- `nexo-adapter.ts` — `prefer-const`.

### 2.4 Decimal — accumulation d'intérêts en float

`applyDueInterestForUser` sommait les intérêts crédités en `number`
(`totalInterest += Number(...)`), en contradiction avec la règle Decimal.js du
projet. Corrigé en `Decimal`, avec un retour en `string` — ce qui aligne au
passage le type sur `applyDueInterestForSavings` (qui renvoyait déjà une
chaîne). Le seul consommateur UI ne lit que `periodsCredited`.

---

## 3. Points vérifiés et jugés sains

Ces points ont été audités et **n'ont pas** nécessité de correctif — utile à
savoir pour ne pas les ré-auditer :

- **Isolation multi-tenant.** Les 51 routes sont scopées. Les 4 sans `userId`
  sont légitimes (session, health). Les écritures par id brut sont toutes
  précédées d'une lecture scopée ; `mergePlatforms` valide bien la propriété des
  deux plateformes avant le `delete`.
- **CUMP.** `app/lib/accounting/cump.ts` est du Decimal pur, correct sur
  l'achat, la vente, le transfert et le split (coût total conservé).
- **Modale.** `components/ui/modal.tsx` est d'un très bon niveau
  d'accessibilité : focus trap, Échap conscient de la pile, restauration du
  focus, scroll-lock à compteur, `inert`, `aria-modal` / `labelledby` /
  `describedby`.
- **Validation.** Toutes les routes mutantes acceptant un corps valident en Zod.
  Les 8 sans schéma n'acceptent pas de corps.
- **Agrégats d'allocation en float.** `byClass` / `byPlatform` /
  `byAccountType` sont en `number`, mais alimentent des camemberts — les totaux
  patrimoniaux, eux, passent bien par Decimal. Pas de correctif nécessaire.

---

## 4. Points laissés en l'état (avec justification)

- **N+1 dans les routines de réparation Solana/Zerion.** Boucles d'`update`
  séquentielles dans `solana-onchain-to-ledger.ts` et consorts. Ce sont des
  backfills de métadonnées, exécutés rarement, chaque ligne portant des données
  distinctes : la mise en lot apporterait peu et ajouterait du risque.
- **Routes sans `try/catch`.** Un throw non capturé dans un route handler
  App Router renvoie un 500 générique — pas de crash serveur ni de fuite.
  L'ajout massif de `try/catch` serait un gros diff pour un gain faible.
- **Fichiers monolithiques.** `import-csv-modal.tsx` (2626 lignes),
  `platforms-tab.tsx` (1854), `holdings-section.tsx` (1552),
  `portfolio/service.ts` (1469). Découpage souhaitable mais hors budget de
  cette passe, et à faire avec une couverture de tests dédiée en amont.

---

## 5. Non audité dans cette passe

À ne pas considérer comme validé :

- Adaptateurs d'import CSV (IBKR, Nexo, Hyperliquid, Paradex) — logique de
  parsing et de dédoublonnage non relue ligne à ligne.
- Sync wallets (Solana RPC, Zerion, Monero) — au-delà du scoping tenant.
- Amortissement des passifs et avenants.
- Épargne salariale, assurance-vie, private equity, crowdlending, métaux,
  tangibles — modules métier non relus.
- Refresh des prix / providers (Binance, CoinGecko, Yahoo) et stratégie de cache.
- Parcours UX complets (onboarding, command palette, préférences d'affichage).
- Design system : cohérence des espacements, typographie, densité, dark mode.
- Suite e2e Playwright — exécutée par la CI, non analysée.

---

## 6. Recommandations

Par valeur décroissante :

1. **Retirer `continue-on-error: true` du job lint.** C'est ce réglage qui a
   laissé passer deux erreurs. Le lint est maintenant vert : le verrouiller
   coûte une ligne et empêche la récidive.
2. **Étendre le contrôle « prix de revient inconnu » au-delà du fiscal.** La
   même absence de lot affecte le P&L réalisé affiché ailleurs dans l'app ; le
   signalement mis en place ne couvre que l'onglet Fiscalité.
3. **Tester les adaptateurs d'import sur fichiers réels.** C'est la principale
   porte d'entrée de données fausses, et la zone non auditée la plus à risque.
4. **Découper les 4 fichiers monolithiques**, en commençant par
   `import-csv-modal.tsx`, après avoir figé le comportement par des tests.
