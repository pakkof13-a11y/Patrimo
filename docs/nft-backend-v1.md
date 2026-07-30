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

Voir §6 en fin de document une fois les vagues 2 à 6 livrées.
