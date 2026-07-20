# Zerion Wallet API

Remplace GoldRush/Covalent pour les wallets **EVM multi-chain**.

- **Solana** : module Helius / `app/lib/solana` (non modifié)
- **Monero** : solde local + CoinGecko
- **EVM** : Zerion

## Endpoints

- Positions : `GET https://api.zerion.io/v1/wallets/{address}/positions/`
- Transactions : `GET https://api.zerion.io/v1/wallets/{address}/transactions/`

Auth : `Authorization: Basic base64(apiKey + ":")`

## Rate limit (free)

1 req/s · 300/jour → throttle **1100 ms** entre appels dans `app/lib/zerion/client.ts`.

## Dates

Timestamps → **Europe/Paris** · `DD-MM-YYYY HH:mm:ss`

## API app

```
POST /api/wallets/zerion/sync
{ "platformId", "address", "apiKey?", "chainPreset?", "writeLedger?" }

POST /api/wallets/monero/sync
{ "platformId", "amount", "writeLedger?" }
```

## Config

```env
ZERION_API_KEY=zk_…
```

Champ plateforme `walletApiKey` pour surcharge par wallet.
