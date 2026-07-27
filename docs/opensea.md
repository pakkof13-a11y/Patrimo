# OpenSea API v2 — Patrimo

Intégration **NFT / marketplace** via l’API officielle OpenSea.

- **EVM tokens fungibles** : Zerion (`app/lib/zerion`)
- **Solana SPL** : `app/lib/solana`
- **NFT (multi-chain OpenSea)** : ce module

## Auth

Toutes les requêtes API passent le header :

```http
x-api-key: YOUR_API_KEY
```

### Clé instantanée (free-tier agents)

```bash
curl -X POST https://api.opensea.io/api/v2/auth/keys
```

Réponse typique :

```json
{
  "api_key": "…",
  "name": "agent_free_…",
  "expires_at": "…",
  "rate_limits": { "read": "60/m", "write": "5/m" }
}
```

Dans Patrimo, si `OPENSEA_API_KEY` est vide et `OPENSEA_AUTO_KEY` n’est pas `false`,
le client appelle cet endpoint une fois par process et met la clé en cache mémoire
(`createInstantOpenSeaApiKey` / `ensureOpenSeaApiKey`).

**Limites free-tier** : 60 req/min read · expire ~30 jours · max 3 créations de clé / heure / IP.

### Clé production

Portail : https://opensea.io/settings/developer  
Variable serveur : `OPENSEA_API_KEY` (jamais `NEXT_PUBLIC_`).

## Endpoints app

```
GET  /api/wallets/opensea/nfts?address=0x…&chain=ethereum&limit=50
POST /api/wallets/opensea/nfts
{ "address", "chain?", "collection?", "limit?", "next?", "allPages?", "maxPages?", "apiKey?" }

GET  /api/wallets/opensea/collection?slug=boredapeyachtclub
POST /api/wallets/opensea/collection
{ "slug", "apiKey?" }
```

Session utilisateur requise. Rate-limit applicatif en plus du throttle OpenSea (1100 ms).

## Client

| Fichier | Rôle |
|---------|------|
| `app/lib/opensea/client.ts` | HTTP, auth, NFTs, stats collection |
| `app/lib/opensea/chains.ts` | Mapping preset → `chain` OpenSea |
| `app/lib/opensea/index.ts` | Exports publics |

### OpenSea upstream

- NFTs wallet : `GET /api/v2/chain/{chain}/account/{address}/nfts`
- Stats collection : `GET /api/v2/collections/{slug}/stats`
- Clé instantanée : `POST /api/v2/auth/keys`

## Config

```env
# Recommandé en prod (clé durable)
OPENSEA_API_KEY=

# true (défaut) = créer une clé free-tier si OPENSEA_API_KEY vide
OPENSEA_AUTO_KEY=true
```

## Sécurité

- Ne jamais committer une `api_key` réelle.
- Ne pas logger la clé.
- Préférer une clé developer pour la prod (rate limits + durée de vie).
