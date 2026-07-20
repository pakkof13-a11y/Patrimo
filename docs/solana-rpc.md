# Solana — RPC natif (sans Solscan)

## Architecture

```
app/lib/solana/
  address.ts           # validation base58
  rpc-client.ts        # Connection, retry/backoff, concurrence
  wallet-balances.ts   # getBalance + getTokenAccountsByOwner
  transaction-parse.ts # parse getParsedTransaction (minimal)
  sync-service.ts      # historique incrémental + curseur
  wallet-service.ts    # orchestration snapshot + txs + ledger
  types.ts
  index.ts
```

**RPC autorisés uniquement :**

| Méthode | Usage |
|---------|--------|
| `getBalance` | SOL natif |
| `getTokenAccountsByOwner` (`jsonParsed`) | tokens SPL (+ Token-2022) |
| `getSignaturesForAddress` | liste signatures (pagination) |
| `getParsedTransaction` | détail par signature |

**Config :** `SOLANA_RPC_URL` (défaut `https://api.mainnet-beta.solana.com`).  
**Plus de `SOLSCAN_API_KEY`.**

## Persistance

| Champ / table | Rôle |
|---------------|------|
| `Platform.lastKnownSignature` | Curseur = signature la **plus récente** déjà vue |
| `Platform.lastSyncedAt` | Horodatage dernière sync |
| `BlockchainOnchainTx` | Une ligne par `(platformId, signature)` — idempotent |

### Synchro transactionnelle (activée par défaut)

Le bouton **« Rafraîchir + txs »** charge **soldes + historique on-chain**  
puis écrit le journal (date = `blockTime`) et réconcilie les positions.

Désactiver l’historique : `syncTransactions: false` dans le body API.

1. **Premier run** (`lastKnownSignature` null) : max **40** signatures (public) / **80** (RPC dédié), parse séquentiel.
2. **Runs suivants** : nouvelles signatures seulement (max **25** / **40**).
3. Une signature déjà en base n’est **pas** re-téléchargée (`@@unique`).
4. Conversion journal : `writeOnchainTxsToLedger` — notes `[onchain:<sig>]`, idempotent.
5. Liste UI : `GET /api/wallets/solana/transactions?platformId=…`

Overrides : `SOLANA_INITIAL_SIG_LIMIT`, `SOLANA_INCREMENTAL_SIG_LIMIT`, `SOLANA_TX_PARSE_GAP_MS`.

### Anti-spam RPC

| Réglage | Valeur (public mainnet-beta) |
|---------|------------------------------|
| File d’attente | 1 RPC à la fois |
| Délai min entre appels | ~750 ms (`SOLANA_RPC_MIN_INTERVAL_MS`) |
| `disableRetryOnRateLimit` | true (pas de retry 500 ms web3.js) |
| Concurrence parse txs | 1 |
| Rate-limit API app | 4 sync / min / user |

### Snapshot soldes → patrimoine

Toujours recalculé depuis le RPC (soldes courants), puis alignement ledger (`writeSolanaSnapshotToLedger`) : ACHAT/REWARD/VENTE de réconciliation.  
Indépendant de l’historique on-chain stocké.

## API

`POST /api/wallets/solana/sync`

```json
{
  "platformId": "…",
  "address": "…",
  "writeLedger": true,
  "syncTransactions": true,
  "fullResync": false
}
```

Réponse : `{ snapshot, ledger, txSync, source: "solana-rpc" }`.

## Prix

Les prix USD ne viennent **pas** du RPC Solana (non fournis).  
CoinGecko Demo : `/simple/price` (SOL/USDC/USDT) + `/simple/token_price/solana` (mints).  
Ce n’est **pas** un indexeur on-chain type Solscan/Helius Enhanced.

## Écarts vs ancien comportement Solscan Pro

| Capacité | Solscan Pro | RPC natif Patrimo |
|----------|-------------|-------------------|
| SOL + SPL balances | ✅ portfolio enrichi | ✅ `getBalance` + token accounts |
| Prix / valeur USD | ✅ dans portfolio | ⚠️ CoinGecko (partiel, mints non listés = 0) |
| Reputation / low-score filter | ✅ | ❌ — dust qty=0 seulement |
| Historique tx enrichi (labels, contreparties) | ✅ | ⚠️ parse minimal (transferts SOL/SPL, fees, programmes) |
| Décodage swap Jupiter/Raydium lisible | ✅ | ❌ type `SWAP_LIKE` heuristique seulement |
| NFT / DeFi positions LP | ✅ | ❌ hors scope |
| Stake rewards détail | ✅ | ❌ (programme stake détectable grossièrement) |
| Synchro incrémentale | selon produit | ✅ curseur signature |
| Dépendance clé payante | Solscan JWT | ❌ (RPC public ou URL custom) |

## Limites RPC public

- Rate limit mainnet-beta → retry exponentiel ; préférer un RPC dédié (`SOLANA_RPC_URL`) en usage réel.
- Historique profond limité par le nœud (pas d’archive garantie sur le public).
- `fullResync` ne remonte pas l’infini : plafond `SOLANA_INITIAL_SIG_LIMIT` (env, max 200).
- Relancer « Rafraîchir + txs » plusieurs fois pour paginer plus loin (curseur avance).

## Migration

- Code Solscan **supprimé** (`app/lib/market/solscan.ts`).
- Env `SOLSCAN_API_KEY` **obsolète** (peut être retirée du `.env`).
- UI : libellés « RPC Solana » à la place de Solscan.
