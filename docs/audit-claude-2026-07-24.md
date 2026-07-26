# Audit Aurea — 2026-07-24

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
| UX / UI — dashboard, positions, mobile | Constaté sur l'app réelle (captures) | ❌ 3 défauts corrigés |
| Contraste WCAG AA — clair et sombre | Mesuré sur tous les textes du dashboard | ❌ 5 échecs corrigés → 0 |
| Nav mobile · onboarding compte vierge | Parcourus sur l'app réelle | ❌ 1 défaut corrigé · onboarding sain |
| Courbe de croissance du patrimoine | Données API + rendu, toutes plages | ❌ 37 faux krachs corrigés |
| Finition bandeau KPI · tableau Positions | Mesuré à 390 / 1024 / 1440 / 1920 px | ❌ 3 défauts de finition corrigés |
| Plus/moins-values cumulées et décomposées | Les 4 combinaisons mode × vue | ❌ Axe illisible corrigé |
| Détail de position (expansion + décompo.) | Ouvert sur l'app réelle | ❌ Signe des frais corrigé |
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

## 2 bis. Passe UX / UI

Menée **sur l'application réellement lancée** (build de prod, base seedée,
captures Chromium en 1440×900 et 390×844), pas sur lecture de code — plusieurs
hypothèses formulées depuis le code se sont d'ailleurs révélées fausses (voir
§3).

### Une classe d'allocation non identifiable

La mosaïque applique une divulgation progressive selon la taille de tuile
(nom → % → montant). La plus petite tombait sous le seuil du **nom** et
s'affichait en bloc gris sans nom, ni %, ni montant. Sa seule identification
était l'attribut `title` natif : survol prolongé requis, inexistant au tactile.

→ Les classes qui ne peuvent pas porter leur libellé sont désormais listées en
légende sous la mosaïque (« Autre 2,8 % »). Le seuil est centralisé dans
`fitsName()` pour que tuiles et légende ne divergent pas.

### Allocation muette pour les lecteurs d'écran

`role="img"` rend les enfants présentationnels : l'`aria-label` générique
(« Allocation par classe d'actifs ») était donc **tout** ce qu'une aide
technique recevait — la répartition elle-même était inaudible. L'`aria-label`
énumère maintenant chaque classe avec sa part et son montant.

### Bandeau KPI : 8 tuiles empilées sur mobile

La grille demandait un minimum de `11.25rem`, ce qui rate les deux colonnes
sur un écran de 390 px à quelques pixels près. Les 8 indicateurs s'empilaient
donc un par ligne : ~750 px à dérouler avant d'atteindre le moindre contenu.
Un minimum de `9.5rem` en dessous de `sm` en fait tenir deux (366 px), la
grille desktop restant inchangée. Vérifié à 360 / 390 / 414 px : aucune valeur
tronquée, aucun défilement horizontal introduit.

### Positions : deux colonnes P&L indiscernables

Tronqués, « P&L latent (€) » et « P&L latent (%) » s'affichaient tous deux
« P&L LAT… » dans deux colonnes voisines — impossible de distinguer le montant
du pourcentage sans survoler chaque en-tête, et impossible tout court au
tactile. L'unité passe avant « latent » pour survivre à la troncature à
n'importe quelle largeur de colonne.

### Contraste : 5 paires sous le seuil AA

Mesuré au ratio WCAG sur chaque nœud de texte du dashboard, en thème clair et
sombre — pas à l'œil.

| Texte | Fond | Ratio | Seuil |
|---|---|---|---|
| Tuiles « Cryptomonnaies », « 6.2 % » | ambre `#d97706` | 3,19 | 4,5 |
| Tuiles « Actions / ETF », « 27.9 % », montant | bleu `#0284c7` | 4,10 | 4,5 |
| Initiales d'avatar (sombre uniquement) | `--primary` teal | **1,86** | 4,5 |

La mosaïque écrivait en blanc sur **toutes** les teintes. `readableInkOn()`
choisit désormais, entre blanc et encre foncée, celle qui contraste le mieux
avec l'aplat : le calcul suit la palette si elle évolue, et l'ombre portée n'est
conservée que là où l'encre est claire.

Les initiales d'avatar utilisaient `text-white` en dur sur `--primary`, or
`--primary` est un teal **clair** en thème sombre. Le design system définissait
déjà `--primary-foreground` correctement apparié par thème (`#ffffff` /
`#042f2e`) — les composants le contournaient simplement.

Après correctif : **0 violation** dans les deux thèmes.

### Barre d'onglets mobile : défilement sans affordance

625 px d'onglets dans 367 px de large. La nav défile bien
(`overflow-x-auto`), mais rien ne l'indiquait : le dernier onglet était
simplement coupé. Le bord s'estompe maintenant du côté où il reste des onglets
à atteindre, et pas du tout quand tout tient. `navRef` était déclaré et
inutilisé — il sert désormais à la mesure.

---

## 2 ter. Parcours vérifiés et jugés sains

- **Onboarding d'un compte vierge.** Testé sur un utilisateur créé sans aucune
  donnée : parcours guidé en 3 étapes (Plateforme → Journal → Positions), barre
  de progression, CTA principal explicite, étapes suivantes verrouillées tant
  que la précédente n'est pas faite, et le principe métier énoncé d'emblée
  (« Les transactions sont la source de vérité »). **Aucun correctif** — c'est
  déjà de bonne facture. Seule réserve, non traitée : beaucoup d'espace vide
  sous la carte sur un écran large.
- **Thème sombre.** Appliqué correctement (`html.dark`, fonds et surfaces
  cohérents). Les seuls défauts étaient les contrastes ci-dessus.

### Courbe de patrimoine : 37 faux krachs

**Sévérité : élevée** (la courbe de patrimoine était mensongère).

Sur « Tout », la courbe tombait de ~830 k à ~360 k puis remontait dès le point
suivant, deux fois, plus une dent de scie mensuelle : **37 chutes de −58 %**.
Aucune transaction n'existe dans ces fenêtres — c'était donc purement de
l'affichage.

La courbe fusionne deux sources : la reconstruction jour par jour depuis le
ledger et les `PortfolioSnapshot`. Tout snapshot portant un latent non nul
**remplaçait le point reconstruit en entier**. Or les deux ne mesurent pas le
même patrimoine :

| | Reconstruction | Snapshot |
|---|---|---|
| Cash | 301 400 € (poches incluses) | 28 000 € |
| Coût des positions | 581 222 € | 340 000 € (figé) |

Le snapshot ne couvre que le périmètre « titres » : son `cashTotalEur` ignore
les poches explicites (banques, livrets, AV, enveloppes), son `totalCostEur`
ignore les actifs alternatifs — et sur le jeu de démonstration il reste figé à
340 000 € quelle que soit la date.

**Correctif** — la reconstruction prime partout où elle existe ; les snapshots
ne comblent plus que les jours qu'elle n'atteint pas. Aucun mark-to-market n'est
perdu : la reconstruction est volontairement valorisée au coût, et la valeur de
marché du jour est ajoutée séparément en point « live ». La logique est extraite
dans `mergeHistorySources()` pour être testable hors base.

Vérifié de bout en bout : plus aucune variation supérieure à 25 % entre deux
points consécutifs.

### Axe de la vue décomposée illisible

Les graduations affichaient « 219,2 k », « 80,8 k », « −69,2 k » : la borne
valait `maxAbs × 1,12`, donc un nombre quelconque, que Recharts découpait en
graduations tout aussi quelconques. `symmetricZeroDomain` arrondit désormais au
palier 1 / 2 / 2,5 / 5 × 10ⁿ — le même graphe lit « 200 k / 100 k / 0 / −100 k /
−200 k ». La symétrie autour de zéro est inchangée.

### Frais retranchés sur un achat

**Sévérité : moyenne** (deux chiffres contradictoires sur la même ligne).

Deux affichages calculaient `brut − frais` pour **tous** les types de trade.
Juste pour une vente, faux pour un achat. Un bien acheté 285 000 € avec
12 000 € de frais s'affichait à 273 000 €, quand la colonne PRU de la **même
ligne** indiquait 297 000 € — le coût de revient réellement retenu par
`applyBuy`. Les frais sont désormais signés par le sens de l'opération, et
l'opérateur affiché suit (`+` à l'achat) pour que l'arithmétique reste lisible.

### Finition « premium » du bandeau et du tableau

Trois détails qui faisaient « inachevé » sur les deux écrans les plus vus.

**Grille KPI déséquilibrée.** `auto-fit` calait le nombre de colonnes sur la
largeur disponible, sans rapport avec le nombre de tuiles : 9 colonnes pour 8
tuiles à 1920 px, et 6 colonnes à 1440 px — donc 2 tuiles orphelines sur une
seconde ligne aux quatre cinquièmes vide. Paliers fixes (2 / 4 / 8) qui divisent
exactement les huit du cas nominal. Mesuré : 8×1 à 1920, 4×2 à 1440 et 1024,
2×4 à 390 ; aucune valeur tronquée, aucun défilement horizontal.

**Aucune hiérarchie sur le chiffre de tête.** Le patrimoine net avait le même
poids visuel que les sept autres tuiles, en dernière position. Nouvelle prop
`accent` sur `Kpi` (fond teinté, liseré interne, valeur agrandie) plutôt qu'un
`className` brut, pour que la mise en avant reste dans le design system.

**Jetons internes exposés.** La source de cours sous chaque valeur du tableau
Positions affichait le jeton brut en capitales : « SEED », et en production
« COINGECKO » ou « COÛT ». `priceSourceLabel()` renvoie le nom réel du
fournisseur et se contente de capitaliser une source non répertoriée, pour ne
jamais masquer une provenance.

Contraste re-mesuré après l'ajout du fond teinté : toujours **0 violation**
WCAG AA dans les deux thèmes.

### Tableau Positions : en-têtes et noms coupés

Six en-têtes sur dix étaient tronqués à 1440 px. Le tableau tient pourtant dans
son conteneur (1288 px pour 1289 px) : ce sont les **libellés** qui débordaient
de leur emplacement, pas les colonnes qui manquaient de place. Raccourcis à ce
que le contexte rend déjà non ambigu — *Cours, Qté, Enveloppe, Valeur, P&L %,
P&L €* — le libellé complet restant dans l'infobulle et le sélecteur de
colonnes, qui ont la place. La devise quitte l'en-tête « Valeur » puisque
chaque cellule porte déjà le symbole. Mesuré après : **10 sur 10 propres**.

Les noms d'actifs, eux, étaient coupés en plein mot **sans ellipse**
(« Appartement Loca »), ce qui se lit comme un bug. La ligne flex n'avait pas
de `min-w-0`, donc la colonne de texte refusait de rétrécir sous sa largeur de
contenu et la cellule la rognait. Corrigé avec `truncate` et le nom complet au
survol.

### Carte d'onboarding isolée en haut de page

En maturité `empty` / `setup`, `dashboardBlocksFor` désactive tous les autres
blocs : la carte d'activation reste seule, suivie de plusieurs centaines de
pixels vides. Centrée verticalement dans ce seul cas. Vérifié sur un compte
réellement vierge et sur un compte actif (aucune classe ajoutée).

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
- **Courbe d'évolution du portefeuille.** Soupçonnée de tracer des points non
  reliés d'après une capture basse résolution ; vérification faite au zoom, la
  ligne est correctement tracée. Le palier suivi d'un saut vient des données de
  seed (prix rafraîchis le jour même), pas du rendu.
- **Transitions des graphiques.** Supposées inexistantes lors d'un changement
  de plage ; mesure faite, le tracé est bien interpolé (6 valeurs de `path`
  distinctes sur 720 ms) et aucun attribut `isAnimationActive` ne fuit dans le
  DOM. Aucun correctif — la suggestion venait d'une impression, pas d'un
  constat.
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
- Parcours UX non parcourus : onboarding d'un compte vierge, command palette,
  préférences d'affichage, import CSV de bout en bout, onglets Banques / AV /
  Épargne salariale / Alternatifs / Passifs.
- Design system : cohérence des espacements, typographie, densité, dark mode
  (les captures ont été prises en thème clair uniquement).
- Contraste vérifié sur le **dashboard** uniquement : les autres onglets
  (Positions, Transactions, modules métier) n'ont pas été mesurés.
- Espace vide sous la carte d'onboarding sur grand écran : constaté, non traité.
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

---

## 7. Suite — P&L journalier par classe d'actif (25 juillet)

### 7.1 Le blocage levé

L'audit avait laissé la vue « Décomposée / Périodique » en l'état, faute de
données : l'historique du portefeuille est volontairement valorisé **au coût**
(`buildHistoryFromOccurredAt` pose `unrealizedPnlBase: 0`), et `PriceHistory`
n'enregistre qu'une capture spot à chaque rafraîchissement de cours — série
creuse, irrégulière, et vide tant que l'utilisateur n'a lancé aucun refresh.
Impossible, dans ces conditions, de dire ce que la journée a fait sur les
actions par rapport aux cryptos.

Quatre couches ont été ajoutées, chacune validée avant la suivante.

**1. Cœur de calcul** (`app/lib/portfolio/class-history.ts`) — pur, sans Prisma
ni réseau. La définition retenue du P&L journalier neutralise les flux :

```
P&L(jour, classe) = Σ actifs [ q_j × close_j − q_{j-1} × close_{j-1} − flux_j ]
                    + revenus_j
```

Une simple différence de valeur de marché aurait été fausse : acheter 10 k€
d'actions un mardi serait apparu comme un gain de 10 k€. Les revenus encaissés
sont rattachés à la classe de l'actif payeur, sans quoi un détachement de
dividende se lirait comme une perte sèche.

**2. Extraction depuis le journal** — les conventions suivent exactement
`applyTransaction` : frais capitalisés à l'achat comme le fait `applyBuy`,
produit net de frais à la vente, revenus nets de retenue à la source. Un test
recoupe le flux d'achat contre le coût de revient que le ledger inscrit
réellement, pour que les deux ne puissent pas diverger en silence. Les
réceptions gratuites (REWARD / AIRDROP) portent un flux nul : rien n'a été
dépensé, la valeur qui apparaît est bien un revenu en nature.

Les quantités viennent du **rejeu** du ledger, seule source de vérité pour
l'état des positions — une somme de quantités signées serait fausse dès le
premier split (test dédié).

**3. Cache de clôtures** (`AssetDailyClose`, migration
`20260725120000_asset_daily_close`) — un point régulier par jour civil, alimenté
depuis les fournisseurs déjà utilisés par les graphiques de cours. C'est un
cache et rien d'autre : le vider ne perd aucune donnée, les transactions restent
la source de vérité. Le remplissage est best effort et ne remonte jamais
d'erreur. Les séries `mock` sont refusées à l'écriture : ce qui évite un
graphique vide à l'écran deviendrait ici un P&L inventé présenté comme réel.

**4. Branchement UI** — servi par sa propre route `/api/portfolio/class-pnl`,
et non replié dans `getPortfolioHistory` : le remplissage du cache peut appeler
des fournisseurs, et le dashboard ne doit pas payer ce coût pour un panneau que
l'utilisateur n'ouvrira peut-être pas. La requête ne part qu'en vue décomposée
périodique. Les jours sont reventilés sur l'intervalle affiché (le P&L est un
flux, les buckets se somment). La décomposition comptable reste le repli quand
les cours journaliers manquent — un découpage exact vaut mieux qu'un découpage
parlant et faux.

### 7.2 Défaut de palette corrigé

« Obligations » (ardoise) et « Autre » (gris) se retrouvaient côte à côte dans
la même pile de colonnes à **dE 18,2** — sous le seuil où l'œil sépare deux
teintes de façon fiable sur de petits aplats. Obligations passe au cyan sur les
graphiques (dE 28,3, plus aucune paire rapprochée). Un test verrouille la
contrainte sur l'ensemble de la palette plutôt qu'un commentaire.

### 7.3 Vérifications

Mesuré dans l'application réelle à 1440 px, cache amorcé :

- 5 classes empilées, légende en clair (« Actions / ETF », « Cryptomonnaies »…) ;
- colonnes centrées sur leur repère, largeur 26 px pour un pas de 78 px entre
  jours — **aucun débordement** sur le jour voisin ;
- reventilation hebdomadaire correcte sur 1M (25 segments / 5 semaines) ;
- chaîne serveur complète en 135 ms sur 30 actifs et 10 jours ;
- cas cible reproduit de bout en bout sur la vraie base : **−21 k€ actions,
  +30 k€ cryptos** le même jour.

Portes : **639 tests**, lint, typecheck, build — tous verts.

### 7.4 Limite assumée

L'appel fournisseur lui-même (`fillDailyCloses` → Yahoo / CoinGecko) **n'a pas
pu être exécuté** : la politique réseau de l'environnement de développement
refuse `query2.finance.yahoo.com` (403 au proxy). Tout le reste du chemin a été
vérifié en amorçant le cache directement. Le code de fetch réutilise la cascade
`getAssetPriceHistory` déjà en production pour les graphiques de cours, mais
cette étape précise reste à confirmer sur un environnement disposant d'un accès
sortant.

---

## 8. Volet B — Estimation immobilière DVF (25 juillet)

### 8.1 Le piège central du format DVF

Un fichier DVF décrit **un lot par ligne, pas une vente par ligne**. Une maison
vendue avec son garage et son terrain occupe trois lignes qui partagent le même
`id_mutation` et **répètent** la même `valeur_fonciere`. Deux erreurs guettent :
traiter chaque ligne comme une vente (la même transaction pèse alors trois fois
dans les comparables, un immeuble de 30 lots en pèserait trente), ou sommer les
valeurs foncières (un bien à 300 k€ en vaut 900).

D'où la décision structurante : **agréger à l'import**, une ligne stockée par
`(mutation, type de bien)`. La table est 3 à 4 fois plus petite, la requête
d'estimation devient triviale, et le piège est éliminé une fois pour toutes au
lieu d'être re-géré à chaque requête.

Vérifié sur données fabriquées : une mutation de 2 lignes à 300 000 € répétés
donne bien 300 000 € pour 60 m², soit 5 000 €/m² — et non 600 000 €.

### 8.2 Surfaces : les dépendances exclues

La surface ne cumule que les **locaux d'habitation**. Inclure le garage
gonflerait la surface et écraserait mécaniquement le prix au m². Une maison de
125 m² habitables avec 25 m² de garage est donc valorisée sur 125 m², la
présence de la dépendance étant conservée dans `hasDependency` plutôt que jetée.

### 8.3 Filtres d'admission

Chacun est compté par motif dans `DvfImport.rejectReasons` : un import qui
écarte 40 % de ses lignes doit pouvoir dire pourquoi, sinon on ne distingue pas
un filtrage sain d'un mapping de colonnes cassé.

| Règle | Raison |
|---|---|
| `nature_mutation` = Vente / VEFA | adjudications et expropriations ne reflètent pas le marché |
| Maison ou appartement | les dépendances ne se valorisent pas au m² habitable |
| Mutation mono-type | une vente groupant maison + appartement a une valeur globale inattribuable |
| Surface et valeur > 0 | sans quoi le prix au m² est indéfini |
| Coordonnées présentes | sans géolocalisation, la ligne est inutilisable |
| 100 ≤ prix/m² ≤ 50 000 € | écarte les ventes à 1 € et les erreurs de saisie |

### 8.4 Géographie sans PostGIS

Boîte englobante servie par un index B-tree `(latitude, longitude)`, puis
Haversine sur le résidu. Sans la seconde étape, un « rayon de 1 km » serait un
carré de 2 km de côté : 27 % de surface en trop, concentrée dans les coins,
donc un biais silencieux vers les biens en diagonale. La largeur en longitude
suit le cosinus de la latitude — un degré vaut ~111 km à l'équateur mais ~82 km
à Marseille ; une constante perdrait des comparables vers le nord.

### 8.5 Médiane, et pas d'élagage

Médiane du prix au m², jamais moyenne : le marché produit des valeurs extrêmes
structurelles qu'une moyenne absorbe mal. Aucun élagage des aberrations n'est
appliqué **avant** le calcul — la médiane y est déjà insensible, et la fourchette
interquartile est justement ce qu'on affiche comme incertitude ; la rétrécir
afficherait une précision qui n'existe pas.

Sous 15 comparables au plus large rayon (10 km), **aucun montant n'est renvoyé**.
Une médiane sur trois ventes serait un chiffre habillé en estimation.

### 8.6 Deux défauts trouvés et corrigés en cours de route

- **Le compteur d'import mentait** : il additionnait ce qu'on *tentait*
  d'insérer, pas ce qui l'était. Un millésime recouvrant un autre annonçait
  « 93 ventes enregistrées » alors que zéro ligne était écrite. `createMany`
  rend le vrai décompte ; les doublons sont désormais comptés à part.
- **Un import raté détruisait les données existantes.** La purge précédait le
  téléchargement : une URL injoignable ou un fichier malformé effaçait le
  millésime déjà chargé sans rien mettre à la place. La source est maintenant
  ouverte et son en-tête validé **avant** toute suppression. Vérifié : après un
  fichier malformé puis une URL en échec, les 93 ventes précédentes sont
  toujours là.

### 8.7 Vérifications

Chaîne complète éprouvée sur un fichier DVF fabriqué reproduisant les pièges du
format réel (mutations multi-lignes, valeur répétée, dépendances, immeuble
mixte, adjudication, vente à 1 €, ligne sans coordonnées) :

- chaque piège écarté exactement une fois, avec son motif ;
- appartement 60 m² au Vieux-Port → 240 000 €, médiane 4 000 €/m², IQR
  3 500–4 500, 61 comparables, rayon **non élargi** (1 km), confiance HIGH ;
- une vente située à 5 km n'entre pas dans le rayon de 1 km ;
- zone sans données → `insufficientData`, aucun montant, rayon poussé à 10 km ;
- import rejouable : réimporter le même millésime laisse 93 ventes, pas 186 ;
- route non authentifiée → 307 vers `/login`, paramètres invalides → 400 détaillé.

Portes : **739 tests**, lint, typecheck, build — tous verts.

### 8.8 Limites assumées

- **Aucune donnée n'a été chargée** : data.gouv.fr est bloqué par la politique
  réseau de cet environnement (403 au proxy, comme Yahoo). Le script a été
  éprouvé sur fichier local ; le chemin de téléchargement HTTPS n'a pas pu être
  exécuté de bout en bout.
- **Estimation strictement consultative** : rien n'est écrit sur les actifs, le
  patrimoine net continue de reposer sur les valeurs saisies et sur le principe
  « transactions = source de vérité ».
- **`DvfSale` et `DvfImport` n'ont pas de `userId`** — premiers modèles du schéma
  dans ce cas. Ce sont des données publiques identiques pour tous, entièrement
  reconstructibles ; ce n'est pas une entorse à l'isolation mais un référentiel
  partagé, documenté comme tel dans le schéma.
- **DVF ne couvre ni l'Alsace-Moselle (57, 67, 68) ni Mayotte**, régimes de
  publicité foncière distincts. `isDvfCoveredDepartment()` permet de le dire à
  l'utilisateur plutôt que de lui montrer un secteur apparemment sans ventes.
- **Index géographique** : B-tree pour l'instant. `cube` et `earthdistance` sont
  disponibles sur la base si un département réel se révèle lent — à mesurer,
  pas à ajouter par précaution.
- **DVF+ (Cerema) non intégré** : conditions d'accès non vérifiables d'ici.

---

## 9. Vérification de bout en bout des transactions (25 juillet)

### 9.1 Défaut majeur trouvé — le journal masquait 92 % des transactions

`GET /api/transactions` ne renvoyait que **10 lignes sur 127** pour le compte de
démonstration, **uniquement des APPORT**. Achats, ventes, dividendes, loyers :
tous invisibles dans le journal, alors que la base les contenait bien.

Cause : l'exclusion des NFT était écrite en `NOT [ … ]` sur des `contains`. En
SQL, `NOT (colonne LIKE '%nft%')` vaut `UNKNOWN` quand la colonne est `NULL`, et
un `WHERE` ne conserve que ce qui est **vrai**. Deux effets se cumulaient :

- `NOT (notes LIKE …)` écartait toute transaction **sans notes** (127 → 115) ;
- `NOT (asset.notes LIKE …)` — champ presque toujours vide — écartait **toute
  transaction portant un actif** (127 → 15).

Reste 10. Et zéro transaction NFT réelle dans le jeu de données : le filtre
n'écartait que des faux positifs.

**Correction** : la clause s'exprime désormais en `AND` de conditions déjà
négatives, chacune gérant ses propres valeurs nulles (`notes IS NULL`,
`assetId IS NULL`, `asset.notes IS NULL`). Trois pièges Prisma rencontrés au
passage, chacun corrigé après mesure : `mode` doit être frère de `not` et non
imbriqué ; une relation optionnelle exige `is:` explicite ; et `Asset.name`
étant non nullable, lui appliquer un filtre `null` fait rejeter la requête
entière.

Mesuré après correction : **127/127 visibles**, les 13 types présents. Contrôle
inverse — 6 transactions créées dont 4 marquées NFT (notes « OpenSea »,
« ERC-721 », « metaplex », actif nommé « Bored Ape NFT ») : seules les 2
normales apparaissent. Le filtre fait son travail sans emporter le reste.

Verrouillé par 9 tests (`tests/unit/transactions/nft-filter-nulls.test.ts`) qui
imposent qu'aucune condition ne puisse à nouveau perdre les valeurs nulles.

### 9.2 Saisie manuelle — 40/40

Banc `scripts/check-transactions-e2e.mjs`, tous types exercés via l'API :

| Contrôle | Résultat |
|---|---|
| Type, quantité, prix, frais, date conservés à l'identique | conforme |
| PRU intègre les frais d'achat (10 × 100 + 5 → 100,50) | conforme |
| Second achat : **une seule ligne**, PRU recalculé 113,67 | conforme |
| Vente partielle : quantité 15 → 9, **PRU inchangé** (CUMP) | conforme |
| 13 types créés et relus avec le bon tag | conforme |
| Split 2:1 : quantité doublée, coût de revient inchangé, PRU divisé par 2 | conforme |
| REWARD + AIRDROP : quantité +3, **coût d'acquisition nul** | conforme |

### 9.3 Import CSV — 13/13

Banc `scripts/check-import-sync-e2e.mjs`, format français (point-virgule,
décimales à la virgule, dates JJ/MM/AAAA) :

- `20/02/2026` lu comme le 20 février, pas le 2 décembre ;
- `120,50` et `2,50` lus comme 120,5 et 2,5 ;
- ACHAT et VENTE correctement tagués ;
- position préexistante **incrémentée** : 10 + 5 + 3 − 4 = 14 titres sur une
  seule ligne, coût de revient 1 552,44 € exactement conforme au calcul CUMP ;
- **import rejoué** : 3 lignes détectées comme doublons strictes, aucune
  écriture créée.

### 9.4 Synchronisation on-chain

Le réseau étant bloqué dans cet environnement, la synchro RPC n'a pas pu être
exécutée en direct. Le **mapping** a été éprouvé en injectant des transactions
Solana en base, comme le ferait la sync, puis en appelant
`writeOnchainTxsToLedger` :

- une écriture au journal par transaction on-chain ;
- date reprise du `blockTime`, **pas** de la date de synchronisation ;
- réception gratuite taguée `REWARD`, actif classé `CRYPTO` ;
- quantités fidèles aux montants on-chain (2,5 et 1,25 SOL) ;
- rejeu **idempotent** : 2 doublons détectés, aucune écriture ;
- position SOL existante **incrémentée** de 51,75 à 55,50, sur une seule ligne
  agrégeant les deux plateformes, **sans augmentation du coût d'acquisition**
  (réception gratuite).

### 9.5 Point de conception confirmé, pas un défaut

`getHoldings` agrège par actif **toutes plateformes confondues** et expose la
liste dans `platformIds`. Un même titre détenu chez deux courtiers apparaît donc
en une ligne — comportement voulu, vérifié explicitement.

Portes : **748 tests**, lint, typecheck, build — tous verts. Données de test
purgées, base de démonstration restaurée à ses 115 transactions d'origine.
