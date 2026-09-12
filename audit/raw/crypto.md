# audit-cryptos — Crypto-monnaies (sync, double valo, courbe ≠ BTC)

```
ID:             CRY-01
Gravité:        P2
Fichier:ligne:  app/lib/market/solana-solscan-import.ts:167-176 (appelé par wallet-service.ts:81,94)
Reproduction:   1 signature swap → Solscan rend 2 lignes (out USDC, in SOL), même trans_id. Ligne1 : tag absent → REWARD/VENTE écrit. Ligne2 : tag trouvé → skipped, jamais journalisée. Les deux écrivains utilisent la même clé — pas de double écriture en séquentiel.
Effet:          1 jambe sur 2 au journal par tx multi-jambes ; la jambe manquante est absorbée par la réconciliation snapshot datée `now` (→ CRY-02). Le P0 "deux écrivains, clés divergentes" de la vague 1 n'est pas confirmé ; le défaut réel est une perte, pas un doublon.
Déjà connu:     oui (vague 1, requalifié)

ID:             CRY-02
Gravité:        P1
Fichier:ligne:  app/lib/market/solana-ledger-sync.ts:97-119 (repairWalletSyncJournalDates), appelée après les écritures :467,599
Reproduction:   Sync N : réconciliation non-premier-fill → ACHAT/VENTE occurredAt=new Date(). :615 repair : |occurredAt−createdAt|<24h vrai → occurredAt redaté au 1er blockTime du mint (ou native, ou __any__). Puis remis à blockTime par un autre repair à la sync suivante, jusqu'à createdAt+24h.
Effet:          Tout ajustement de réconciliation (dont ceux de CRY-01/03/04) et toute clôture de token sont datés du premier blockTime du wallet, de façon permanente. Courbe spot : +qty×clôture rétroactivement sur toute la fenêtre depuis le 1er tx. Montant [NON MESURÉ] ; mécanisme déterministe.
Déjà connu:     non

ID:             CRY-03
Gravité:        P1
Fichier:ligne:  app/lib/market/solana-onchain-to-ledger.ts:306-315 ; wallet-service.ts:94 (limit:150, sans onlyNewSinceMs)
Reproduction:   Requête status=success orderBy blockTime asc take 150, sans exclure les lignes déjà journalisées. 1ère sync avec clé Solscan : jusqu'à 160 lignes possibles. Toute ligne plus récente que les 150 plus anciennes n'est jamais parcourue.
Effet:          Arrêt silencieux de la journalisation RPC→journal au-delà de 150 lignes ; l'écart est absorbé par la réconciliation snapshot (→ CRY-02). Seuil déterministe ; volume [NON MESURÉ].
Déjà connu:     non

ID:             CRY-04
Gravité:        P2
Fichier:ligne:  app/lib/solana/sync-service.ts:176-183 (curseur:=newestSig inconditionnel) ; :218-245 ; rpc-client.ts:62-69 (Vercel+RPC public=8)
Reproduction:   20 nouvelles signatures, Vercel sans SOLANA_RPC_URL : maxSigs=8. collectSignatures s'arrête à 8, curseur:=la plus récente. Les 12 intermédiaires ne seront jamais redemandées (until les exclut). truncated:true retourné mais aucun appelant ne pagine.
Effet:          Trou permanent dans BlockchainOnchainTx et le journal ; rattrapé par le snapshot mais daté now (→CRY-02). [NON MESURÉ] nombre de tx perdues.
Déjà connu:     non

ID:             CRY-05
Gravité:        P1
Fichier:ligne:  app/lib/solana/wallet-balances.ts:55-78 ; solana-ledger-sync.ts:164-189 (filtre dust laisse passer bal=1) ; spot-history-service.ts:128-136,206-214 ; providers/coingecko.ts:114-116
Reproduction:   Wallet détenant 1 NFT Metaplex (amount=1, decimals=0) ou 1 token spam non coté. Snapshot → Asset sol:<mint>, sans manualPrice → ligne "comptant". fillDailyCloses → 404/inexistant → source "mock" → 0 clôture. valueHeldAtDay → missing non vide → complete:false → aucun point pour chaque jour détenu.
Effet:          La courbe "Évolution" comptant n'a plus aucun point à partir de l'entrée du mint, tandis que coveragePct (compté en lignes) affiche p.ex. 80% → écran "couvert à 80%" avec courbe vide. [NON MESURÉ] jours perdus par utilisateur.
Déjà connu:     non

ID:             CRY-06
Gravité:        P3
Fichier:ligne:  app/lib/market/solana-solscan-import.ts:202,243
Reproduction:   Solscan rend flow absent/hors {in,out} → "unknown" → direction:"in" (l.202) ; l.243 flow≠"out"→"in" → REWARD entrant.
Effet:          Une direction inconnue devient une entrée de quantité au journal, corrigée ensuite par une VENTE de réconciliation datée now (→CRY-02). [NON MESURÉ] fréquence.
Déjà connu:     non

ID:             CRY-07
Gravité:        P3
Fichier:ligne:  app/api/wallets/solana/sync/route.ts:49 (rate limit 4/min, pas de verrou par plateforme) ; solana-onchain-to-ledger.ts:337-431, solana-ledger-sync.ts:425-536 (non atomiques)
Reproduction:   2 POST sync pour le même platformId en chevauchement (2 onglets). BlockchainOnchainTx protégé par @@unique (P2002) ; le journal ne l'est pas → 2 écritures ; delta snapshot calculé 2× → 2 ACHAT.
Effet:          Doublon journal/quantité doublée jusqu'à la sync suivante. [NON MESURÉ] — course non reproduite.
Déjà connu:     non
```
