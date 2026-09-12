# audit-api-write — routes write (74), hors défauts déjà trouvés audit 1

```
ID:             API-W-01
Gravité:        P1
Fichier:Ligne:  crypto/defi/positions/[id]/events/route.ts:163-191 ; crypto/defi-position-service.ts:140-346
Reproduction:   POST events {eventType:"CLAIM_REWARD", eventDate:"pas-une-date"} → claimReward() décrémente l'accru HORS transaction, puis recordEvent() lève "Date invalide" → 400. Rejouer le même 400 retire `quantity` de plus à chaque fois.
Effet:          DefiReward.accruedQuantity/valueEur décrémentés sans événement journalisé, cumulativement à chaque tentative échouée — rewardsValueEur de la valorisation faussé, sans trace.
Déjà connu:     non

ID:             API-W-02
Gravité:        P2
Fichier:Ligne:  wallets/solana/sync/route.ts:113-142
Reproduction:   POST sync {address:"0xdead"} → platform.update walletAddress="0xdead" écrit AVANT la validation → 400 INVALID_ADDRESS ensuite.
Effet:          Mutation persistée malgré la réponse 400 ; une adresse valide existante est remplacée par n'importe quelle chaîne invalide.
Déjà connu:     non

ID:             API-W-03
Gravité:        P2
Fichier:Ligne:  wallets/zerion/sync/route.ts:144-272
Reproduction:   POST sync {apiKey:"mauvaise"} → walletApiKey/walletAddress écrits AVANT fetchZerionPortfolio → 401 ensuite.
Effet:          Une clé invalide écrase la clé valide stockée ; toute sync ultérieure échoue jusqu'à re-saisie. 401 fournisseur indiscernable d'une session expirée côté client.
Déjà connu:     non

ID:             API-W-04
Gravité:        P2
Fichier:Ligne:  wallets/zerion/sync/route.ts:201-252 ; wallets/monero/sync/route.ts:79-94 ; wallets/solana/sync/route.ts:184-197
Reproduction:   Échec de writeZerionBalancesToLedger (ou équivalent Monero) → réponse 200 {ok:true, ledgerWritten:false, ledgerError:"…"}.
Effet:          "200 avec un corps d'erreur" — aucune position écrite, statut HTTP vert. savings/accrue a été corrigé (207/500) pour ce motif exact ; ces 3 routes de sync gardent l'ancien contrat.
Déjà connu:     non (distinct de PER-02 qui porte sur maxDuration)

ID:             API-W-05
Gravité:        P2
Fichier:Ligne:  import/commit/route.ts:42-139 ; import/commit.ts:88-186 ; schema.prisma:209
Reproduction:   POST commit avec accountEnvelopeType:"XYZ", assetClass:"FOO" arbitraires (aucun zod sur le corps) → Asset créé avec ces valeurs hors énumération.
Effet:          Contourne z.enum(accountTypes) que POST /api/assets applique ; une ligne "AV" peut créer un actif AV sans LifeInsuranceSupport, hors de tout onglet d'enveloppe.
Déjà connu:     non

ID:             API-W-06
Gravité:        P3
Fichier:Ligne:  crypto/defi-strategy-service.ts:99-103 ; securities/account-service.ts:252 ; securities/fiscal-service.ts:186-189
Reproduction:   DELETE sur un id d'un autre user ou inexistant → 200 {deleted:false} (pas d'IDOR, filtre userId présent, mais "succès" sur un cas d'échec).
Effet:          Même défaut que celui déjà corrigé sur banks/savings/term-deposits (D39/D40) — pas encore répliqué sur ces 3 routes. Erreurs métier aussi mappées en 500 générique.
Déjà connu:     non

ID:             API-W-07
Gravité:        P3
Fichier:Ligne:  precious-metals/route.ts:45-94 ; crowdlending/route.ts:41-76 ; private-equity/route.ts:41-76 ; tangibles/route.ts:92
Reproduction:   Erreur Prisma (panne infra) sur POST → 400 {error:"Erreur"} générique via clientErrorMessage.
Effet:          Panne d'infrastructure rendue comme une erreur de saisie utilisateur ; aucune distinction métier/infra possible sur crowdlending/private-equity (Error non typées).
Déjà connu:     non

ID:             API-W-08
Gravité:        P3
Fichier:Ligne:  crypto/nft/[assetId]/route.ts:55-60 ; nft-manual-service.ts:278-281 ; positions/[assetId]/flags/route.ts:66-79
Reproduction:   PATCH {isHidden:true, manualFloorPriceEur:"-1"} → setNftHidden commit, puis setNftManualFloorPrice lève "prix négatif" → 400.
Effet:          Mutation partielle sur réponse 400 (deux services, deux transactions distinctes non liées). Même motif sur flags.
Déjà connu:     non

ID:             API-W-09
Gravité:        P3
Fichier:Ligne:  crypto/defi-position-service.ts:165-191
Reproduction:   POST events avec un txHash déjà lié à un événement synchronisé (ZERION) → update() réécrit l'événement, ledgerTransactionId=null, sourceProvider="MANUAL" → 200 {created:false}.
Effet:          Le lien événement→écriture de journal est perdu sur une réponse qui annonce "rien créé".
Déjà connu:     non

ID:             API-W-10
Gravité:        P3
Fichier:Ligne:  crypto/defi/positions/route.ts:230-249
Reproduction:   DELETE avec identifiant dans le corps JSON {assetId} plutôt qu'en query param/segment d'URL.
Effet:          Convention fragile (proxies/keepalive) et incohérente avec toutes les routes sœurs (?id=/segment).
Déjà connu:     non

ID:             API-W-11
Gravité:        P3
Fichier:Ligne:  savings/route.ts:188-277
Reproduction:   PUT sur un livret pendant qu'un autre PUT modifie un livret différent du même user → applyDueInterestForUser (hors transaction) crédite les intérêts sur TOUS les livrets, puis 409 "modifié entre-temps" sur la ressource ciblée.
Effet:          Mutation d'autres ressources (intérêts + events INTEREST sur les livrets n-1) sur une réponse 409, non annulable.
Déjà connu:     non (distinct de BAN-01, qui porte sur l'effacement des intérêts projetés)
```

**Résultat négatif explicite** : aucun GET qui écrit trouvé dans le périmètre ; aucun IDOR trouvé (toutes les mutations filtrent par userId direct ou relation vérifiée).

**Couverture** : ouverts en profondeur (route + service) — assets/**, transactions, crypto/defi/positions/** (+services), crypto/defi/strategies/**, crypto/defi/sync, crypto/defi/valuations/refresh, crypto/nft/** (+services), banks, savings(+accrue), term-deposits/**, precious-metals/**, tangibles/**, crowdlending, private-equity, envelopes, import/{commit,analyze,preview}, securities/{accounts,contributions,positions}, tax/marginal-rate, real-estate/{estimate/address,geocode,indirect}, prices/refresh, wallets/{monero,solana,zerion}/sync, admin/users. Survolés : life-insurance/{route,supports,coupons}, real-estate/{rent-schedule,properties/[id]/*}. Non ouverts (déjà couverts audit 1 ou hors lot) : platforms/**, preferences/clear-data, liabilities, employee-savings/**, crypto/futures/**, trading/**, auth/change-password, real-estate/properties POST.
