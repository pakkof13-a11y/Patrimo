# Backend NFT — note de décision technique (V1)

Chantier G (« Partie 1 : Back End »). Périmètre : backend seul, aucun travail
frontend hors adaptations de types strictement nécessaires au build.

## 1. Ce que le dépôt contenait déjà

| Brique | État avant ce chantier |
| --- | --- |
| `NftItemDetail` | Modèle 1:1 avec `Asset` (`assetId @unique`). Porte **à la fois** l'identité technique (`tokenId`, `contractAddr`, `chain`, `standard`), la collection (`collectionName`/`collectionSlug` en clair, pas de table dédiée) et la détention (`isHidden`, `notes`, `valuationMode`, `floorPrice*`, `estimateSource/Date`, `rarityRank/Score`). |
| Valorisation | `Asset.manualPrice` pilote la valeur réelle via `getAssetValues()` (journal). `floorPriceEur`/`estimateSource`/`estimateDate` sur `NftItemDetail` ne sont qu'un historique déclaratif — **déjà** conforme à la règle « pas de vérité de valeur indépendante », à conserver telle quelle. |
| Saisie manuelle | `nft-manual-service.ts` : `createNftManual` (Asset + detail + écriture d'entrée dans une transaction DB), `setNftHidden`, `setNftManualFloorPrice`, `deleteNftItem` (suppression **physique** — actif + transactions + detail). |
| Sync wallet | `nft-wallet-sync.ts` : une seule page par provider (OpenSea EVM / Magic Eden Solana), identité par `Asset.providerSymbol = nft:chain:contract:tokenId`, entrée au journal via `REWARD` (pas de prix connu). Aucun curseur, aucune pagination, aucune détection de disparition. |
| Estimation floor | `nft-estimate.ts` (pur : provider principal + repli par chaîne) + `nft-estimate-service.ts` (regroupe par collection unique, convertit en EUR, écrit `Asset.manualPrice`). Providers : OpenSea, Blur, Magic Eden, Tensor, Reservoir — chacun dégradé proprement en `not-configured` sans clé. |
| Routes | `GET/POST/DELETE /api/crypto/nft`, `PATCH /api/crypto/nft/[assetId]`, `POST /api/crypto/nft/sync`, `POST /api/crypto/nft/estimate`. |
| Taxonomie | `nft-constants.ts` : 3 standards (ERC-721/1155/SPL), 6 chaînes, sources d'estimation. |

### Angles morts constatés

1. **Identité et détention confondues** dans une seule table : impossible de dédupliquer un NFT vu par deux wallets ou deux providers sans dupliquer sa metadata, et un rafraîchissement de metadata doit aujourd'hui parcourir toutes les lignes de détention au lieu d'une seule ligne d'identité.
2. **Aucune table `NftCollection`** : verified/spam/creator/royalties/floor de collection n'existent qu'en 3 colonnes texte sur la détention, non requêtables et dupliqués à chaque NFT de la même collection.
3. **Aucun journal d'événements** : mint/achat/vente/transfert/burn/bridge/stake ne se distinguent pas — seul un `Transaction` avec une note taguée `[wallet-sync:nft]` existe pour la découverte, rien pour les autres cas.
4. **Pas de curseur de sync, pas de pagination** : une seule page (50 NFT) par appel, aucune reprise, aucune trace d'échec/succès par provider.
5. **Aucune détection spam/scam.** Un NFT non désiré (airdrop indésirable, fake collection) entre au patrimoine avec la même valeur potentielle qu'un NFT légitime.
6. **Aucun anti-double-compte** structurel pour bridge/wrapped/bundle/multi-provider — non nécessaire tant qu'un seul provider par famille de chaîne existait, mais devient un vrai risque dès plusieurs sources.
7. **`DELETE` est une suppression physique** (actif + transactions + detail) : un burn ou une vente perdrait tout son historique, contrairement à la convention DeFi (`closeDefiPosition`) qui clôture sans supprimer.
8. **Pas de traits, pas de médias secondaires, pas de rareté par trait.**
9. **Standard/quantité peu contraints** : `ERC_1155` n'impose aucune règle de quantité, un `ERC_721`/`SPL` pourrait recevoir une quantité > 1 sans qu'aucune validation ne le refuse.

## 2. Décisions

### D1 — Séparer identité (`NftAsset`) et détention (`NftItemDetail`, conservé)

Contrairement au chantier DeFi (où l'identité de protocole restait fondue dans
la position, D1 de `defi-backend-v1.md`), le cahier des charges NFT pose une
**règle absolue** : séparer explicitement identité / collection / holding /
événements / valorisation / classification. On l'applique donc ici, sans la
simplification retenue côté DeFi.

- **`NftItemDetail` est conservé sous ce nom** (déjà 1:1 avec `Asset`, déjà
  référencé par tout le module existant — `nft-service.ts`,
  `nft-manual-service.ts`, `nft-wallet-sync.ts`, les routes, le panneau
  frontend). Il devient la table de **détention** : ce que demande le cahier
  des charges sous le nom `NftHolding`, adapté à la convention du dépôt.
  Renommer la table n'aurait rien changé à la structure et aurait multiplié
  les points de rupture sans bénéfice.
- **`NftAsset` est une nouvelle table**, référencée par
  `NftItemDetail.nftAssetId` (FK obligatoire) : elle porte l'identité
  technique et la metadata (`chainId`, `standard`, `contractAddress`/
  `mintAddress`, `uniqueKey`, nom/description, médias, `rawMetadataJson`,
  qualité de metadata, `isWrapped/isBridged/isCompressed/isSoulbound/isSpam/
  isScamSuspected`, catégorie, rareté).
- **Migration avec backfill, pas de perte de données.** Les colonnes
  d'identité de `NftItemDetail` (`tokenId`, `contractAddr`, `chain`,
  `standard`, `collectionName`, `collectionSlug`, `imageUrl`, `metadataUrl`,
  `rarityRank`, `rarityScore`) sont déplacées vers `NftAsset` par un script
  SQL exécuté **dans la même migration transactionnelle** : création des
  `NftCollection`/`NftAsset` à partir des lignes existantes, remplissage de
  `nftAssetId`, puis suppression des colonnes devenues redondantes. Aucune
  vérité concurrente ne subsiste après la migration (règle absolue du
  cahier des charges).

### D2 — `NftCollection` et `NftAsset` sont scopés par utilisateur

Comme `DefiProtocolRef` (F1) : remplis à la volée, jamais partagés entre
utilisateurs. Un NFT identique détenu par deux comptes de ce dépôt aurait pu
partager une seule ligne `NftAsset` globale, mais cela romprait la convention
de sécurité systématique du dépôt (chaque table filtrée par `userId`, jamais
de lecture croisée). Unicité : `@@unique([userId, chainId, contractAddress,
tokenId])` et `@@unique([userId, chainId, mintAddress])`.

### D3 — Vocabulaire d'accès NFT distinct de celui de la DeFi

Un NFT n'a pas l'axe DeFi/Hybride/CeFi d'un protocole. `accessMode` devient
`NFT_HOLDING_ACCESS_MODES` : `SELF_CUSTODY` (wallet, clé privée détenue) |
`CUSTODIAL` (exchange/marketplace) | `UNKNOWN`. `custodyModel` reprend le
vocabulaire DeFi existant (`SELF_CUSTODY | CUSTODIAL | SHARED_CUSTODY |
UNKNOWN`) sans le dupliquer : un seul fichier de taxonomie NFT les déclare
tous les deux, mais avec des listes distinctes.

### D4 — Valeur : toujours par le journal, jamais stockée comme vérité

Repris tel quel du pattern déjà correct de `nft-estimate-service.ts` /
`nft-manual-service.ts` : `NftValuation` (nouvelle table, calquée sur
`DefiValuation`) enregistre la **méthode** retenue, sa provenance, sa
confiance et la raison d'un repli — c'est un historique décisionnel, jamais
une valeur qu'on relit pour afficher le patrimoine. Le nombre qui pilote
réellement `getAssetValues()` reste `Asset.manualPrice`, mis à jour au moment
où une méthode de valorisation est appliquée (manuelle, floor, last sale,
appraisal). Règle de priorité (§ valorisation du cahier des charges) :
appraisal manuelle > last sale récente et fiable > floor de collection de
qualité suffisante > repli sur le coût d'acquisition > inconnue — un spam
confirmé n'obtient jamais de valorisation positive sans override explicite.

### D5 — Anti-double-compte : `status` + `linkedHoldingId` + `conflictFlag`

Repris du pattern `DefiPositionDetail` : `NftItemDetail.linkedHoldingId`
(`SetNull`) relie les deux extrémités d'un bridge/wrap ou une position liée
après migration de contrat ; `conflictFlag`/`conflictReason` signalent un
doublon multi-provider sans jamais le résoudre silencieusement.
`countsInTotals()` (nouvel agrégateur pur, miroir de celui de la DeFi) exclut
des totaux : spam confirmé (sans override), doublon signalé, statut inactif
(`SOLD/BURNED/TRANSFERRED_OUT` sans lien de continuité) — et inclut toujours
les masqués (cosmétique seulement).

### D6 — Curseur de synchronisation et pagination

`NftSyncCursor`, structurellement identique à `DefiSyncCursor` (même
`scopeKey`, mêmes compteurs `imported/updated/ignored`, mêmes
`lastSyncAt/lastSuccessAt/lastError`). Les providers wallet (OpenSea,
Magic Eden) gagnent une pagination réelle (curseur `next` / `offset`) au lieu
d'une page unique à 50 éléments.

### D7 — Disparition d'un NFT du wallet courant

Une resynchronisation qui ne revoit plus un NFT ne le supprime jamais : elle
pose un événement `SYNC_MISSING` et bascule son statut à `UNKNOWN` si aucune
autre source ne le confirme, sans jamais toucher à la quantité au journal
tant qu'aucune transaction de sortie n'est explicitement constatée (vente,
transfert, burn observés par ailleurs). Documenté comme limite V1 : sans
provider de events on-chain, l'origine exacte de la disparition (vente ?
transfert vers un wallet non suivi ? burn ?) reste à qualifier manuellement.

### D8 — `DELETE` reste une suppression physique, une nouvelle route dispose

L'ancien comportement (`DELETE /api/crypto/nft?assetId=`, suppression
physique de l'actif/transactions/detail) est **conservé sans changement** —
casser sa sémantique romprait le frontend existant sans qu'aucune
modification de celui-ci ne soit demandée ici. Une nouvelle action
`POST /api/crypto/nft/positions/[assetId]/dispose` (mirroir de
`closeDefiPosition`) est ajoutée pour le cas patrimonial réel (vente, burn,
transfert) : elle pose un événement de sortie, ramène la quantité à zéro par
une écriture de journal, et **conserve** la ligne — jamais de suppression.
`DELETE` reste réservé à la correction d'une saisie manuelle erronée, sans
historique réel à préserver.

### D9 — Spam : heuristique déclarative, jamais définitive

`classifyNftSpam()` (fonction pure) combine : collection non vérifiée +
absence de floor + reçu par airdrop sans coût d'acquisition + nom/symbole
suspect (patterns communs de phishing : URL, incitation à « claim »). Résultat
`CLEAN | SUSPECTED | CONFIRMED_SPAM`, jamais appliqué à l'insu de
l'utilisateur : `SUSPECTED` reste visible et valorisable, seul
`CONFIRMED_SPAM` retire la valorisation positive par défaut, et
`IGNORED_BY_USER` permet de requalifier un spam réellement détenu (cas 55 du
cahier des charges) sans perdre la classification technique.

### D10 — Providers : interfaces déclarées, implémentations existantes adaptées

`NftOwnershipProvider` (découverte par wallet), `NftValuationProvider`
(floor/estimation) et `NftMetadataProvider` (rafraîchissement de metadata/
médias/traits) sont déclarés comme interfaces dans
`app/lib/crypto/nft-provider-types.ts`. Les fichiers existants
(`nft-providers/opensea*.ts`, `magic-eden*.ts`, `blur.ts`, `tensor.ts`,
`reservoir.ts`) sont adaptés pour les satisfaire plutôt que réécrits : ils
dégradent déjà proprement en `not-configured`/`rate-limited`/`network-error`.

## 3. Limites V1 documentées

1. **Metadata provider non branché sur un vrai rafraîchissement de traits** :
   `NftTrait`/`NftMedia` existent et sont exploitables par la saisie
   manuelle et par un futur provider, mais aucun appel réseau ne les peuple
   automatiquement en V1 (pas de clé de metadata dédiée disponible).
2. **Fractionalisation** : un champ déclaratif (`isFractionalized` +
   `fractionShare` sur `NftItemDetail`) existe pour l'enregistrer, mais aucun
   calcul de valeur pro-rata dédié n'est implémenté au-delà de
   `ownershipShare` déjà générique.
3. **Compressed NFT (Solana)** : `standard = SPL_COMPRESSED` et un champ
   `compressionId` optionnel sur `NftAsset` couvrent le stockage/l'affichage,
   sans validation spécifique au-delà de celle de `SPL`.
4. **NSFW** : `isSensitiveMedia` (booléen déclaratif sur `NftAsset`), pas de
   système de notation.
5. **CSV** non branché pour les NFT (seule la saisie manuelle et la sync
   wallet le sont) — même limite que documentée pour la DeFi en F1.
6. **Disparition de wallet** : cf. D7, qualification manuelle nécessaire.
7. **Un seul provider par famille de chaîne** pour la découverte wallet
   (OpenSea EVM, Magic Eden Solana) — pas de second provider concurrent en
   V1, donc pas de doublon multi-provider réel à ce stade pour la sync, mais
   la structure anti-double-compte est en place pour quand un second
   provider sera ajouté.

## 4. Vérification finale (mise à jour en fin de chantier)

Vagues 2 à 6 livrées. État à l'issue du chantier :

- `npx tsc --noEmit` : aucune erreur.
- `npx eslint` (fichiers du chantier) : aucun avertissement.
- `npx vitest run` (suite complète) : 162 fichiers, **1871 tests**, tous
  verts — dont 7 nouveaux fichiers dédiés au backend NFT
  (`nft-identity.test.ts`, `nft-valuation.test.ts`, `nft-dedup.test.ts`,
  `nft-classification.test.ts`, `nft-aggregates.test.ts`,
  `nft-taxonomy.test.ts`, `nft-wallet-providers.test.ts`) couvrant les 25
  scénarios obligatoires du cahier des charges, plus les deux fichiers
  préexistants (`nft-wallet-sync.test.ts`, `nft-estimate.test.ts`) confirmés
  toujours compatibles sans modification.
- `npm run build` : compilation Next.js réussie, toutes les routes
  `/api/crypto/nft/...` listées dans la sortie de build.

**Convention de test respectée** : comme pour la DeFi (F1), la suite reste
composée exclusivement de tests de fonctions pures (aucun mock Prisma). Trois
refactors ont été faits spécifiquement pour rendre testable une logique
auparavant enchevêtrée avec Prisma, sans changer son comportement :
`nftDisposalOutcome()` (extrait de `disposeNftHolding`), `applyOwnershipShare()`
(extrait de `applyNftValuation`, avec un changement d'unité du paramètre —
pourcentage brut 0–100 plutôt qu'une fraction pré-divisée — répercuté sur ses
3 points d'appel), et `holdingsGoneMissing()` (extrait de la boucle de
détection `SYNC_MISSING` dans `syncNftsFromWallet`).

**Limites de couverture assumées** (aucun équivalent fonction pure propre) :
- Cas 6 (« collection auto-créée puis enrichie ») : couvert indirectement par
  les tests de `collectionDedupKey` (la clé qui permet de retrouver puis
  d'enrichir la même collection) et par relecture du code de
  `ensureNftCollection` — pas de test Prisma-mocké dédié, cohérent avec la
  convention du dépôt.
- Cas 20 (« sync partielle avec curseur ») : couvert au niveau provider
  (`nft-wallet-providers.test.ts`, fetch mocké selon le patron de
  `finnhub-provider.test.ts`) — pagination OpenSea (`next`) et Magic Eden
  (offset) vérifiées indépendamment de l'orchestration Prisma de
  `syncNftsFromWallet`.

Aucun TODO flou laissé dans le code livré ; les limites V1 réelles sont
listées au §3 ci-dessus, pas en commentaire dans le code.

## 5. Audit post-livraison — correctifs

Relecture du chantier livré contre le cahier des charges. Quatre défauts
réels trouvés et corrigés, tous liés au même angle mort : `NftAsset` et
`NftCollection` pendent de `User`, pas d'`Asset`, et l'onglet NFT était seul
à connaître ses propres règles d'exclusion.

1. **Identités NFT orphelines après suppression.** `resetUserData()`
   (réinitialisation complète depuis les préférences) et le wipe du seed
   supprimaient les `Asset` — donc les `NftItemDetail` par cascade — mais
   laissaient les `NftAsset`/`NftCollection`/`NftSyncCursor`, et avec eux
   leurs événements, valorisations et classification spam. Un réajout du même
   NFT retrouvait l'identité périmée par `uniqueKey` et en héritait
   silencieusement (`ensureNftAsset` ne rejoue jamais la classification, D9).
   Corrigé dans les deux chemins, plus les équivalents DeFi
   (`DefiProtocolRef`/`DefiStrategy`/`DefiSyncCursor`), touchés par le même
   oubli.
2. **`deleteNftItem` laissait l'identité derrière lui.** Même cause, chemin
   utilisateur : corriger une saisie erronée par suppression puis re-saisie
   ne corrigeait rien, l'ancien nom/média/flag spam revenait. La suppression
   nettoie désormais l'identité — et la collection — devenues orphelines, et
   seulement dans ce cas (une revente puis un rachat doit conserver
   l'historique).
3. **`isIgnoredInPortfolio` ignoré par les agrégats globaux.** La règle
   `countsInTotals()` n'était appliquée que dans l'onglet NFT : le patrimoine
   net et le KPI crypto comptaient malgré tout un NFT explicitement exclu, un
   NFT emprunté (`BORROWED_IN`, détenu sans être possédé), un doublon
   signalé, et ignoraient la quote-part. F1 avait fait ce branchement pour la
   DeFi (`app/lib/portfolio/service.ts`), le chantier NFT ne l'avait pas
   répliqué. Corrigé dans `portfolio/service.ts` et
   `crypto/summary-service.ts`.
4. **« Total poche crypto » figé.** Aucun panneau crypto n'invalidait
   `crypto-summary` : exclure un NFT (ou modifier une position DeFi) ne
   mettait à jour le total de l'en-tête qu'au rechargement. Corrigé dans les
   quatre panneaux (NFT et DeFi, liste et détail).

5. **Changements de drapeaux non historisés.** `setNftHoldingFlags` ne posait
   aucun événement, alors que `reclassifyNftSpam` juste à côté pose bien un
   `SPAM_FLAG`. Exclure une détention du patrimoine change les totaux : sans
   trace, la marche correspondante dans la courbe de patrimoine reste
   inexplicable a posteriori. Un `MANUAL_OVERRIDE` est désormais posé sur
   l'exclusion/réintégration et sur la levée d'un conflit — et seulement sur
   un changement réel, pour qu'un rejeu de requête n'empile pas d'événements.
   `isHidden` seul, cosmétique et sans effet sur les totaux, n'en pose pas :
   journaliser un rangement d'écran noierait le journal.

   Le même oubli existait côté DeFi et a été corrigé de la même façon, dans
   les deux chemins qui touchent ces champs : la route `flags` et l'édition
   complète (`PUT`). Côté DeFi, le statut de cycle de vie et la quote-part
   sont historisés en plus de l'exclusion — ils changent eux aussi ce que la
   position pèse.

Couverture ajoutée : `e2e/nft-panel.spec.ts` vérifie désormais que l'exclusion
d'un NFT fait effectivement bouger le total crypto (cas 56) **et** qu'elle
apparaît au journal d'événements de la fiche.

### Ce qui n'a délibérément pas été fait

Les snapshots de patrimoine déjà écrits ne sont **pas** recalculés quand un
actif est exclu : la courbe garde donc une marche à la date d'exclusion.
`PortfolioSnapshot` ne stocke que des agrégats — aucune ventilation par actif
— la contribution passée de l'actif exclu n'y est donc pas récupérable, et un
recalcul supposerait de rejouer tout le journal avec des prix historiques que
les NFT valorisés par repli n'ont pas. Au-delà du coût, un snapshot est une
photo datée : le réécrire à chaque changement d'avis lui retirerait sa raison
d'être. La marche est l'information, pas l'artefact — elle dit « ce jour-là,
cet actif est sorti du patrimoine suivi », et l'événement `MANUAL_OVERRIDE`
ci-dessus en porte désormais la justification.
