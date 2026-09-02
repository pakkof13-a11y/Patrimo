# Backend DeFi / CeFi / CeDeFi — note de décision technique (V1)

Chantier F1. Périmètre : backend seul (aucun travail frontend, hors adaptations
de types nécessaires au build).

## 1. Ce que le dépôt contenait déjà

| Brique | État avant F1 |
| --- | --- |
| `DefiPositionDetail` | Modèle 1:1 avec `Asset` (`assetId @unique`). Porte protocole, chaîne, `positionType`, LP multi-jetons (2 colonnes + JSON `pairedLegs`), plage concentrée, rewards (1 colonne + JSON `extraRewardLegs`), vesting, `healthFactor`/`ltvPct`/`liqThresholdPct`, `source` (`ZERION`\|`MANUAL`). |
| `DefiStrategy` | Regroupement optionnel de positions (`SetNull` à la suppression). |
| Valorisation | `getAssetValues()` → journal (`Transaction`). Aucune valeur stockée. |
| Agrégats purs | `defi.ts` : `summarizeDefi`, `groupByProtocol` / `groupByType` / `groupByStrategy`, `toPositionView`. |
| Taxonomie | `crypto/constants.ts` : `DEFI_POSITION_TYPES` (16 natures), `isDebtPosition`, `refineDefiType` (mapping Zerion), seuils HF/LTV. |
| Saisie manuelle | `defi-manual-service.ts` : `createDefiPosition` (Asset + detail + écriture d'entrée dans une même transaction DB), `closeDefiPosition` (écriture de sortie, jamais de suppression). |
| Sync | `defi-sync.ts` : Zerion `only_complex`, identité par `Asset.providerSymbol = df:chain:proto:type:asset`, réconciliation de quantité par delta. |
| Wallets | Pas de modèle dédié : un wallet **est** une `Platform` (`type = BLOCKCHAIN`, champ `walletAddress`). |

### Angles morts constatés

1. Aucun contexte d'accès : impossible de distinguer DeFi on-chain, hybride et CeFi.
2. Pas de structure de *legs* : le collatéral et la dette d'un même emprunt sont
   deux positions sans lien, et les composantes économiques d'une LP sont
   aplaties en colonnes + JSON.
3. **Aucun journal d'événements** : `deposit`/`claim`/`borrow`/`liquidation` ne
   se distinguent pas, ils ne vivent que comme `Transaction` avec une note taguée.
4. Aucune trace de *méthode* de valorisation ni de sa provenance ; pas d'historique.
5. Rewards en JSON seulement — non requêtables, pas de distinction accru/réclamé.
6. Pas de curseur de synchronisation par fournisseur (seul `Platform.lastSyncedAt`).
7. Anti-double-compte limité au préfixe de clé `df:` vs `zr:`.
8. Pas de `status` : une position fermée ou liquidée est indistinguable d'une active.

## 2. Décisions

### D1 — `DefiPositionDetail` reste l'agrégat racine

Le cahier des charges demande un modèle `DefiPosition`. Nous **conservons le nom
`DefiPositionDetail`** et l'étendons, plutôt que de créer un modèle parallèle.

Raison : ce modèle est déjà 1:1 avec `Asset`, qui fournit à la fois le
propriétaire (`userId`), la plateforme/le wallet (`platformId`) et surtout
**l'ancrage au journal** (`Asset.transactions`). Un `DefiPosition` autonome
dupliquerait cette identité et rendrait mécaniquement possible le second ledger
que les règles absolues interdisent. Le renommer coûterait une migration
destructive et la réécriture de toutes les références, sans rien changer à la
structure.

### D2 — Sept tables satellites, aucune valeur de vérité

Ajoutées : `DefiLeg`, `DefiEvent`, `DefiValuation`, `DefiReward`,
`DefiSyncCursor`, `DefiProtocolRef`, `DefiMarketRef`.

Séparation obtenue :

| Préoccupation | Porteur |
| --- | --- |
| Identité de position | `DefiPositionDetail` (+ `Asset`) |
| Exposition économique | `DefiLeg` |
| Événements | `DefiEvent` |
| Valorisation | `DefiValuation` (+ journal pour la valeur vivante) |
| Dettes / collatéraux | `DefiLeg.legType = DEBT` / `COLLATERAL` |
| Rewards | `DefiReward` |
| Sync / source / provider | `DefiPositionDetail.dataOrigin` + `DefiSyncCursor` |

### D3 — Enums au niveau TypeScript, colonnes `String` en base

Le dépôt n'utilise qu'un seul enum Prisma (`AssetCategory`) ; partout ailleurs la
convention est une colonne `String` documentée par un commentaire `///` et un
objet `as const` côté TS (`DEFI_POSITION_TYPES`, `CRYPTO_CATEGORIES`,
`TRADING_ACCOUNT_TYPES`…). `positionType` est déjà une `String`.

Nous suivons cette convention : source unique dans `defi-taxonomy.ts`
(objets `as const` + types dérivés + validateurs), colonnes `String` en base.
Bénéfice concret : ajouter une nature de position ou un `valuationMethod` ne
demande aucune migration, et Zod valide déjà à la frontière HTTP.

### D4 — `walletAddressId` → `platformId`

Le cahier des charges distingue `walletAddressId` et `platformId`. Le dépôt n'a
pas de modèle d'adresse : un wallet est une `Platform` de type `BLOCKCHAIN`.
Nous gardons donc **un seul** `platformId` (via `Asset.platformId`) et laissons
`accessMode` porter la distinction DeFi / hybride / CeFi. Créer un
`WalletAddress` séparé fragmenterait les positions entre deux notions de source
alors que tout le reste de l'app (imports, prix, transactions) passe par
`Platform`.

### D5 — Quote-part : `ownershipPct`, pas d'entité juridique

`ownershipPct Decimal(6,3)` est la convention déjà en place (`BankAccount`,
`SavingsAccount`, `TermDeposit`). Nous la reprenons. Le cahier des charges
mentionne un `ownerEntityId` : aucun modèle d'entité (SCI, holding) n'existe dans
le dépôt, et en inventer un dépasse ce chantier. `ownerLabel` (chaîne libre)
couvre le besoin de traçabilité en attendant. Documenté comme limite V1.

### D6 — `DefiValuation` est un historique, pas la vérité

Règle absolue : ne pas stocker `currentValue` comme vérité indépendante. La
valeur vivante d'une position continue donc de venir du journal
(`getAssetValues`). `DefiValuation` est un **journal de snapshots** : il conserve
la méthode retenue, la provenance, le score de confiance et la raison du
fallback, pour qu'une valeur affichée hier reste explicable aujourd'hui.

Une seule exception, explicite : `isManual = true` fait prévaloir le snapshot le
plus récent. C'est un choix délibéré de l'utilisateur sur une position dont
aucun marché ne donne le prix (vault opaque, receipt token sans cotation), et
c'est signalé comme tel dans les agrégats via la qualité de valorisation.

### D7 — Événements et journal : liaison, pas duplication

`DefiEvent.ledgerTransactionId` est un FK optionnel vers `Transaction`
(`onDelete: SetNull`). Un événement qui déplace de la quantité est écrit **avec**
son écriture de journal et pointe dessus ; un événement purement informatif
(`SYNC_REFRESH`, `REBALANCE` sans flux net) n'en a pas.

La position reste reconstruisible : `DefiLeg` porte l'exposition courante,
`DefiEvent` l'historique de ce qui l'a produite, et le journal reste seul maître
des quantités valorisées.

## 3. Règles de valorisation retenues

Ordre d'application (`resolveValuation`) :

1. `isManual` actif et non périmé → snapshot manuel (`MANUAL`).
2. Sinon, selon la nature : `MARKET` (jeton coté), `UNDERLYING_ASSETS`
   (LP / vault dont les sous-jacents sont connus), `PROVIDER_ESTIMATE`.
3. Défaut de prix → `ACQUISITION_COST_FALLBACK` (coût du journal), avec
   `fallbackReason` renseigné.
4. Rien d'exploitable → `UNKNOWN`, valeur nulle et position marquée comme non
   valorisable. Jamais un zéro silencieux qui se confondrait avec une position
   soldée.

Décomposition systématique : `gross`, `debt`, `collateral`, `rewards`,
`net = gross − debt`, `retained = net × ownershipPct`. Un emprunt retranche
toujours sa dette — c'est `legType = DEBT` qui le décide, à un seul endroit.

Rewards non réclamés : **inclus** dans `rewards` et dans `gross`, jamais dans
`net` tant qu'ils ne sont pas réclamés → politique explicite, paramétrable par
`includeUnclaimedRewards`. Les points (`POINTS`) sont **hors valorisation
patrimoniale** par défaut : pas de marché fiable, donc pas de chiffre inventé.

## 4. Règles anti-double-compte

Neuf cas traités par `detectDoubleCounting()` :

| Cas | Règle |
| --- | --- |
| Dépôt + receipt token | Un seul des deux compte ; le receipt prime (c'est lui que le wallet détient). |
| LP token + sous-jacents | `UNDERLYING_ASSETS` exclut le `SHARE`, `MARKET` exclut les `UNDERLYING`. |
| Vault share + stratégie interne | Idem : la part de vault, jamais les deux. |
| Collatéral + dette | Agrégés séparément, jamais additionnés. |
| Bridge in/out | Source et destination liées par `linkedPositionId` ; une seule compte. |
| Wallet sync + saisie manuelle | Clé de dédup `(dataOrigin, providerKey)` + drapeau de conflit. |
| API provider + CSV | Même mécanisme. |
| Rewards accrus + réclamés | `accruedQuantity` décrémenté par `claimedQuantity` ; un claim devient une quantité au journal. |
| NFT de position CLMM | Le NFT est un support, sa valeur vient des legs, jamais du marché NFT. |

Les conflits ne sont pas résolus silencieusement : `conflictFlag` est posé et la
position reste visible pour revue manuelle.

## 5. Fichiers livrés

### Modules purs (aucun accès Prisma, testés sans base)

| Fichier | Rôle |
| --- | --- |
| `app/lib/crypto/defi-taxonomy.ts` | Vocabulaire complet : `accessMode`, `custodyModel`, `dataOrigin`, `legType`, `status`, `valuationMethod`, `rewardType`, `provider`, `eventType` + prédicats (`isDebtLeg`, `isInactiveStatus`, `isValuableRewardType`, `requiresProtocol`…). |
| `app/lib/crypto/defi-valuation.ts` | `valuePosition` (décomposition gross/net/debt/collateral/rewards/retained + méthode + repli), `selectValuationLegs` (anti-double-compte interne), `computeDebtRatios`, `debtRiskLevel`, `isStaleValuation`, `decomposeUnderlying`, `summarizeValuationQuality`. |
| `app/lib/crypto/defi-dedup.ts` | `detectDoubleCounting` (5 familles de conflits), `logicalPositionKey`, `underlyingSymbol`, `duplicateIdsToExclude`, `eventDedupKey`. |
| `app/lib/crypto/defi-aggregates.ts` | `countsInTotals` (règle d'inclusion unique), `computeTotals`, `computeExclusions`, `aggregateBy`. |

### Couches Prisma

| Fichier | Rôle |
| --- | --- |
| `app/lib/crypto/defi-position-service.ts` | `replaceLegs`, `recordEvent`, `upsertReward`, `claimReward`, `recordValuation`, `overrideValuation`, `ensureProtocolRef`, `ensureMarketRef`, curseurs de sync (`syncScopeKey`, `updateSyncCursor`…). |
| `app/lib/crypto/defi-portfolio-service.ts` | `getDefiPortfolio` (positions enrichies + totaux + agrégats + conflits + alertes de dette), `applyComputedFilters`, `getDefiNetContribution`. |
| `app/lib/crypto/defi-manual-service.ts` (étendu) | `validateAccessContext`, `validateLegs`, `validateRewards` + écriture des legs/rewards/événement d'ouverture ; `closeDefiPosition` gère `liquidated` et bascule le statut. |
| `app/lib/crypto/defi-sync.ts` (étendu) | `dataOrigin`/`providerKey`/`status` à la création, `syncPositionLegs`, événements de réconciliation adossés au journal. |
| `app/lib/crypto/summary-service.ts` (étendu) | KPI crypto : exclusion des positions ignorées / inactives / en doublon, application de la quote-part. |
| `app/lib/portfolio/service.ts` (étendu) | `isIgnoredInPortfolio` honoré dans les holdings globaux, pour que le patrimoine net ne contredise pas la vue DeFi. |

### Routes

| Route | Méthodes |
| --- | --- |
| `/api/crypto/defi/portfolio` | `GET` (13 filtres) |
| `/api/crypto/defi/positions` | `POST`, `DELETE` (dénouement/liquidation), `PATCH` (stratégie) |
| `/api/crypto/defi/positions/[id]` | `GET` (détail + événements + valorisations), `PUT` |
| `/api/crypto/defi/positions/[id]/events` | `GET`, `POST` |
| `/api/crypto/defi/positions/[id]/valuation` | `POST` (override manuel), `DELETE` |
| `/api/crypto/defi/positions/[id]/flags` | `PATCH` (hide / ignore / status / lever un conflit) |
| `/api/crypto/defi/sync` | `POST`, `GET` (santé des synchronisations) |
| `/api/crypto/defi/valuations/refresh` | `POST` (snapshots + repose des conflits) |

### Tests ajoutés — 130 cas sur 5 fichiers

`defi-valuation.test.ts` (34), `defi-dedup.test.ts` (26), `defi-taxonomy.test.ts` (24),
`defi-position-validation.test.ts` (26), `defi-aggregates.test.ts` (20).

Suite complète après chantier : **154 fichiers, 1707 tests**, tous verts, plus
`lint`, `typecheck` et `build` sans erreur.

## 6. Limites V1 (assumées, non masquées)

1. **Pas de modèle d'entité propriétaire** — `ownerLabel` est une chaîne libre.
   Un `OwnerEntity` (SCI, holding) dépasse ce chantier (D5).
2. **`DefiSyncCursor` alimenté par Zerion seulement.** `DEFI_PROVIDERS` déclare
   DeBank, Covalent et Solana RPC, et la table les accepte, mais aucun n'est
   implémenté. `POST /api/crypto/defi/sync` **refuse** explicitement tout
   `provider` autre que `ZERION` (`z.literal`) plutôt que de renvoyer un succès
   pour une synchronisation qui n'a rien fait.
3. **Reconstruction depuis les événements non automatisée.** `DefiEvent` couvre
   les 19 natures du cahier des charges et pointe vers le journal, si bien que
   la position est reconstruisible *en principe* ; mais aucun rejeu ne recalcule
   les legs depuis les événements. Les legs sont la photographie de l'exposition
   courante, écrite par les services ; les événements sont écrits en parallèle.
   Un rejeu vérificateur (comparer legs reconstruits et legs stockés) est le
   candidat naturel pour la V2.
4. **Pas de résolution automatique des conflits multi-source** — détection,
   signalement (`conflictFlag`) et exclusion des totaux, mais la fusion reste
   une décision humaine (`PATCH …/flags` avec `clearConflict`).
5. **`DefiMarketRef` / `DefiProtocolRef` non pré-peuplés** — remplis à la volée
   par `ensureProtocolRef` / `ensureMarketRef` ; aucun catalogue livré, et les
   services actuels écrivent encore `protocol` en clair sur la position plutôt
   que d'exiger la référence. Les deux coexistent volontairement : imposer le
   référentiel casserait la saisie libre qui fonctionne aujourd'hui.
6. **Sens d'un pont déduit, pas déclaré.** `pickBridgeDestination` tranche par
   statut, puis par `openedAt`, puis par identifiant. Le dernier critère est
   arbitraire mais **stable** : il garantit que les totaux ne changent pas d'une
   lecture à l'autre. Un champ `bridgeRole` explicite serait plus juste.
7. **Prix des jambes sans `Asset` non résolus.** `getDefiPortfolio` ne fait
   aucun appel réseau : une jambe sans actif propre n'a pas de prix et déclenche
   un repli signalé. `defi-service.ts` (vue historique) appelle CoinGecko pour
   l'IL ; unifier les deux demanderait de faire entrer un budget d'appels
   fournisseur dans le chemin de lecture, ce qui a été écarté.
8. **Frontend inchangé** — hors périmètre F1 (contrainte explicite). Les
   nouvelles routes ne sont consommées par aucun composant ; l'onglet DeFi
   existant continue de lire `GET /api/crypto/defi`, inchangé.
