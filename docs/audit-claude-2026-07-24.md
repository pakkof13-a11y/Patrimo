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
| Parsing numérique des imports CSV | Exhaustif sur les 3 chemins de parse | ❌ Corruption 1000× corrigée |
| Empreinte de dédoublonnage import | Lecture complète | ❌ Fragilité corrigée |
| Conventions de signe à l'import | Vérifié bout en bout (qty, frais, prix) | ❌ Frais négatifs corrigés |
| Sémantique métier des adaptateurs | Nexo complet · HL/Paradex partiel | ❌ Aperçu ≠ commit corrigé |
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

### 2.4 Import — séparateur décimal déduit par valeur au lieu du fichier

**Sévérité : élevée** (corruption silencieuse des montants importés, facteur 1000).

`parseNumber` traitait toute virgule isolée comme un séparateur décimal :

```
parseNumber("1,000")  -> 1        (attendu 1000 en locale EN)
parseNumber("1,500")  -> 1.5      (attendu 1500)
parseNumber("12,345") -> 12.345   (attendu 12345)
```

Tout export anglophone employant le séparateur de milliers **sans centimes**
était donc divisé par 1000 à l'import, sans erreur ni avertissement.

Une valeur isolée est réellement indécidable (`1,234` vaut 1.234 en FR et 1234
en EN) — mais un fichier est homogène. `inferDecimalSeparator()` balaie une
colonne entière et tranche sur le signal le plus fort disponible :

1. les deux séparateurs présents (`1,234.56`) → le dernier est le décimal ;
2. un groupe décimal de taille ≠ 3 (`0,00000502`, `12.5`) → ce séparateur est
   le décimal (aucun groupe de milliers ne fait 2 ou 8 chiffres) ;
3. virgules multiples (`1,234,567`) → virgule séparatrice de milliers.

Appliqué aux **trois** chemins de parse : `mapCsvToDrafts` (mapper générique),
puis `alias-adapter` et `dynamic-adapter` via `inferRowsDecimalSeparator()`.
Les colonnes numériques sont mises en commun, un CSV n'employant qu'une locale.

Comportement **inchangé** quand le fichier n'offre aucun signal : les quantités
crypto FR type `0,00000502` sont parsées comme avant.

Tests : `tests/unit/import-decimal-separator.test.ts` (20 cas, dont la preuve
de bout en bout via `parseCsv` → `mapCsvToDrafts`).

### 2.5 Import — empreinte de dédoublonnage sensible au formatage

`normalizeImportNumber` utilisait un `.replace(",", ".")` **non global** et
sans gestion des milliers : `"1,234.56"` devenait `"1.234.56"`, échouait à
`Number()`, et retombait sur la chaîne brute. Elle ne correspondait donc plus à
la valeur canonique `"1234.56"` stockée en base — un même montant écrit de deux
façons produisait deux empreintes, et le doublon passait au travers.

Latent et non actif dans le flux principal (les drafts portent des valeurs
canoniques), mais atteignable dès qu'une valeur est saisie à la main dans
l'aperçu d'import. Le passage par `parseNumber` rend l'empreinte indépendante
du formatage.

### 2.6 Import — un frais négatif retranchait du coût de revient

**Sévérité : moyenne** (coût de revient faux, plus-value surévaluée).

De nombreux courtiers écrivent la commission en **débit négatif** (« -1,00 »).
`applyBuy` calcule `coût = qty × prix + frais` : un frais négatif était donc
*retranché* du coût de revient au lieu de s'y ajouter. Écart total = **deux
fois** le montant des frais, répercuté sur le CUMP puis sur la plus-value à la
revente.

`ibkr-activity` normalisait déjà de son côté (`feeAbs`, commentaire « Fees
souvent négatifs dans IBKR »), mais le **mapper générique** — qui sert tous les
autres courtiers — ne le faisait pas. Les quantités, elles, étaient déjà
absolutisées ; seul le signe des frais manquait.

### 2.7 Import — l'aperçu annonçait autre chose que ce qui était importé

`mapNexoType` renvoyait `"BUY"` pour les lignes d'intérêt : l'aperçu affichait
« Achat » alors que le chemin de commit les classe correctement en revenu. Le
commentaire indiquait déjà « canonical DIVIDEND » — seul le type de retour
interdisait cette valeur.

Reformulé au passage l'avertissement de réception crypto. Une réception est
importée avec un **coût d'acquisition nul** : exact pour un staking ou un
airdrop, faux pour un transfert d'actifs déjà détenus — la position affiche
alors 100 % de plus-value et gonfle l'estimation fiscale à la revente. Le
libellé « Staking / reward » masquait cette conséquence, il l'énonce désormais.

**Laissé en l'état, volontairement** : le commit bascule un `INTERET` libellé en
crypto vers `REWARD` (+qty, coût 0). C'est la modélisation la plus juste d'un
intérêt payé en nature, et non un bug.

### 2.8 Decimal — accumulation d'intérêts en float

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

- Adaptateurs d'import **dédiés** (IBKR, Nexo, Hyperliquid, Paradex) — leur
  logique métier propre (mapping des types, conventions de signe, sens des
  opérations) n'a pas été relue ligne à ligne. Seul le parsing numérique
  partagé a été audité et corrigé (§2.4). Ces exports étant au format US, le
  bug du séparateur ne les touchait pas en pratique.
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
3. **Relire les conventions métier des adaptateurs dédiés** (sens des
   opérations, mapping des types, signes) sur des fichiers réels. Le parsing
   numérique est désormais couvert, mais la sémantique de chaque courtier ne
   l'est pas.
4. **Découper les 4 fichiers monolithiques**, en commençant par
   `import-csv-modal.tsx`, après avoir figé le comportement par des tests.
