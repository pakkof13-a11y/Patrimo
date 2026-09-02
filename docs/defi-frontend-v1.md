# Frontend DeFi / CeFi / CeDeFi — note de décision technique (V1)

Chantier F2. Périmètre : frontend / UI / UX de la sous-catégorie DeFi de
l'onglet Cryptos, au-dessus du backend livré par le chantier F1
(`docs/defi-backend-v1.md`). Aucune reprise du backend hors ajustements de
DTO/validation strictement nécessaires au build et aux scénarios de l'UI.

## 1. Audit de l'existant (avant F2)

L'ancien `components/crypto/defi-panel.tsx` était un formulaire inline unique
(pas de wizard), lisant `GET /api/crypto/defi` (vue historique simple) plutôt
que le bundle enrichi `GET /api/crypto/defi/portfolio` livré par F1. Aucune
règle de visibilité/obligation centralisée : les champs LP/borrowing/restaking
étaient conditionnés par du JSX ad hoc dispersé. Aucun badge de risque/statut
standardisé, pas de panneau de détail séparé, pas de flow de synchronisation
dédié.

## 2. Architecture retenue

Toute règle de présentation (visibilité, obligation, libellé, aide
contextuelle, reset en cascade, badges, actions disponibles, affichage de
valorisation, état vide) vit dans un seul module client-safe :
`app/lib/crypto/defi-ui-rules.ts`. Il n'importe que des modules purs
(`defi-taxonomy.ts`, `constants.ts`) — aucune dépendance Prisma — et peut donc
être importé directement par les composants `"use client"`, sans duplication
de constantes comme cela avait été nécessaire pour l'immobilier.

Composants (`components/crypto/defi/`) :

| Fichier | Rôle |
| --- | --- |
| `defi-kpis.tsx` | KPI patrimoniaux (retenue, brut, dette, collatéral, rewards, comptages qualité) + répartitions top-5. |
| `defi-filters.tsx` | Barre de recherche + panneau de filtres repliable (17 critères) + prédicat de filtrage client `matchesDefiFilters`. |
| `defi-table.tsx` | Vue tableau analytique (colonnes responsives, dette en négatif, badges). |
| `defi-badges.tsx` | Rendu de badge standardisé, accessible (jamais couleur seule). |
| `defi-empty-state.tsx` | 6 états vides distincts avec CTA contextuel. |
| `defi-detail-panel.tsx` | Panneau de détail (9 sections) + actions + édition + surcharge de valorisation manuelle. |
| `defi-position-form.tsx` | Wizard d'ajout 9 étapes à divulgation progressive, confirmations de reset. |
| `defi-sync-modal.tsx` | Flow de synchronisation wallet, résultat chiffré + état du portefeuille après coup. |

`components/crypto/defi-panel.tsx` reste le point d'entrée (même signature
`DefiPanel({ className })`), désormais un pur orchestrateur : requêtes
react-query, filtrage, montage conditionnel des modales.

## 3. Ajustements backend minimes (nécessaires au build/UX, pas une reprise F1)

1. **Protocole non obligatoire hors DeFi directe.** Le schéma Zod de
   `POST /api/crypto/defi/positions` et `defi-manual-service.ts` imposaient un
   protocole non vide pour *tous* les modes d'accès, alors que
   `validateAccessContext` (F1, correcte) ne l'exige qu'en `DEFI`. Corrigé aux
   deux couches — seule `validateAccessContext` porte désormais la règle.
2. **DTO enrichi côté portfolio** (`defi-portfolio-service.ts`) : passthrough
   de colonnes Prisma déjà chargées mais absentes du DTO client
   (`isConcentrated`, `priceRangeMin/Max`, `pairedSymbol`, `unlockAt`,
   `cliffAt`) — nécessaires aux badges CLMM et lock/vesting de l'UI.
3. **`ownerLabel`/`ownershipPct` sur la synchronisation** (`defi-sync.ts`,
   route `sync`) : le flow de sync doit pouvoir préciser un détenteur et une
   quote-part dès la création — appliqué uniquement à la branche `create` du
   upsert, jamais à `update` (même convention que `dataOrigin`/`accessMode`).
4. **`validateLegs` (BORROWING) corrigé.** La règle F1 exigeait une
   composante `DEBT` explicite dans les *legs* soumis, alors que
   `createDefiPosition` ajoute déjà d'office une jambe `DEBT` primaire quand
   aucune composante ne porte le symbole principal — un emprunt saisi via le
   wizard (collatéral seul, comme prévu par le formulaire) était donc
   systématiquement rejeté. La règle vérifie désormais qu'un éventuel actif
   principal explicitement listé n'est pas mal étiqueté (`ASSET`/`COLLATERAL`
   au lieu de `DEBT`), ce qui est la seule vraie erreur possible une fois
   l'auto-ajout pris en compte.

Aucun changement de modèle Prisma, aucune migration.

## 4. Choix de conception notables

- **LP multi-jetons → legs `UNDERLYING`.** Le wizard traduit les jetons
  appariés en `legs: [{legType:"UNDERLYING", ...}]` plutôt que de dupliquer les
  anciens champs `pairedSymbol/pairedAmount` en parallèle d'un calcul
  spécifique : le moteur de valorisation F1 (`UNDERLYING_ASSETS`) somme alors
  correctement l'exposition multi-jetons sans code de valorisation dédié côté
  UI.
- **Emprunt → un seul leg `COLLATERAL` ajouté.** L'actif/quantité/prix du
  formulaire représentent la dette elle-même (auto-tagués `DEBT` par
  construction) ; le wizard n'ajoute que la composante collatérale.
- **Pas de leg de dépôt séparé pour liquid staking / restaking.** L'actif
  engagé du formulaire reste le jeton reçu (receipt token), cohérent avec la
  synchronisation Zerion existante — pas de saisie d'un actif sous-jacent
  distinct en V1.
- **CLMM : jamais de statut in-range/out-of-range inventé.** Aucun flux de prix
  de marché n'est interrogé par le bundle (choix F1 : pas d'appel réseau dans
  l'agrégation) ; le badge affiche uniquement les bornes statiques saisies,
  avec une mention explicite que le statut n'est pas calculé.
- **`showInactive`/`showHidden`/`showIgnored` sont purement client.** Les
  positions fermées/liquidées sont toujours chargées
  (`includeInactive=true`) puis filtrées à l'affichage par
  `matchesDefiFilters`, exactement comme masquées/ignorées — cohérence entre
  les trois bascules, et aucun aller-retour serveur (donc aucun flash de
  chargement) au clic sur un filtre d'affichage.

## 5. Limites V1 documentées

1. **Pas de vue de groupement par stratégie** (`DefiStrategy`) côté UI F2 — non
   demandé par le cahier des charges F2 ; l'API/backend de stratégie reste
   fonctionnelle et exploitable par d'autres moyens. `e2e/defi-strategy.spec.ts`
   (ancien test du formulaire inline) a été supprimé en conséquence.
2. **Pas de layout carte dédié mobile** : le tableau utilise un scroll
   horizontal (`overflow-x-auto`) avec colonnes secondaires masquées sous les
   points de rupture, plutôt que des cartes empilées.
3. **Seule la synchronisation par wallet (Zerion) est câblée** — API de
   plateforme et import CSV restent au stade de mention dans la copie
   (limite déjà documentée côté backend F1).
4. **Formulaire d'édition limité aux champs scalaires pris en charge par
   `PUT /positions/[id]`** (libellé propriétaire, quote-part, protocole,
   chaîne, APY, health factor/LTV si dette, notes) — ni la quantité ni le prix
   ne sont éditables ici : ils appartiennent au journal (nouvel événement/
   position à créer plutôt qu'une correction rétroactive).
5. **Rafraîchissement de valorisation uniquement portefeuille entier** —
   pas de bouton « rafraîchir cette position seule » en V1.
6. **CLMM in-range/out-of-range non calculé** (cf. §4) — affichage des bornes
   seules.
7. **Aucun média/preview enrichi pour les NFT-backed positions** au-delà des
   champs texte (`nftPositionRef`) — hors périmètre F2 (module NFT séparé).

## 6. Vérification finale

- `npx tsc --noEmit` : aucune erreur.
- `npx eslint` (fichiers touchés) : aucune erreur (avertissements d'ignore
  attendus sur les specs e2e, hors périmètre lint).
- `npx vitest run` : 1752 tests, tous verts (dont 44 nouveaux tests
  `defi-ui-rules.test.ts` et les ajustements de `defi-position-validation.test.ts`).
- `npm run build` : succès.
- `npx playwright test e2e/defi-panel.spec.ts e2e/defi-lp.spec.ts` : 16/16
  verts (wizard toutes natures, confirmations de reset, détail, filtres,
  cycle de vie, synchronisation, mobile).
