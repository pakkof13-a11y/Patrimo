# API Routes Inventory (hors app/api/portfolio/**, déjà couvert par l'audit 1)

Généré par `find app/api -name "route.ts" | grep -v "^app/api/portfolio/"`, catégorisé par méthodes exportées (`grep -oE "export async function (GET|POST|PATCH|PUT|DELETE)"`).

Règle de catégorisation : `cron` si le chemin contient `/cron/` ; sinon `write` si la route exporte POST/PATCH/PUT/DELETE (même si elle exporte aussi GET) ; sinon `read` (GET seul) ; `auth-special` pour le handler NextAuth qui n'exporte pas de fonction nommée.

**Total routes (hors portfolio) :** 108
**Orphelines :** 0 (tous les fichiers `route.ts` trouvés sont rattachés à un chemin `app/api/**` valide)
**Exclues (audit 1) :** app/api/portfolio/route.ts, daily-nav, class-pnl, intraday, sparklines (5 fichiers)

## write (74)

| Chemin | Méthodes |
|---|---|
| /api/admin/users | DELETE,GET,PATCH,POST |
| /api/assets/[id]/account-type | PATCH,PUT |
| /api/assets/[id]/category | PATCH,PUT |
| /api/assets/[id] | GET,PATCH |
| /api/assets/[id]/triggers | PATCH |
| /api/assets/[id]/watchlist | PATCH |
| /api/assets | GET,POST |
| /api/auth/change-password | POST |
| /api/banks | DELETE,GET,POST,PUT |
| /api/crowdlending | DELETE,GET,POST,PUT |
| /api/crypto/defi/positions/[id]/events | GET,POST |
| /api/crypto/defi/positions/[id]/flags | PATCH |
| /api/crypto/defi/positions/[id] | GET,PUT |
| /api/crypto/defi/positions/[id]/valuation | DELETE,POST |
| /api/crypto/defi/positions | DELETE,PATCH,POST |
| /api/crypto/defi/strategies/[id] | DELETE,PATCH |
| /api/crypto/defi/strategies | GET,POST |
| /api/crypto/defi/sync | GET,POST |
| /api/crypto/defi/valuations/refresh | POST |
| /api/crypto/futures/import | POST |
| /api/crypto/futures | DELETE,GET,POST,PUT |
| /api/crypto/nft/[assetId] | PATCH |
| /api/crypto/nft/estimate | POST |
| /api/crypto/nft/positions/[assetId]/dispose | POST |
| /api/crypto/nft/positions/[assetId]/flags | PATCH |
| /api/crypto/nft/positions/[assetId] | GET,PUT |
| /api/crypto/nft/positions/[assetId]/valuation | DELETE,POST |
| /api/crypto/nft | DELETE,GET,POST |
| /api/crypto/nft/sync | POST |
| /api/employee-savings/import | POST |
| /api/employee-savings | DELETE,GET,POST,PUT |
| /api/envelopes | GET,PUT |
| /api/import/analyze | POST |
| /api/import/commit | POST |
| /api/import/preview | POST |
| /api/liabilities | DELETE,GET,POST,PUT |
| /api/life-insurance/coupons | GET,POST |
| /api/life-insurance | DELETE,GET,POST,PUT |
| /api/life-insurance/supports | DELETE,GET,POST,PUT |
| /api/platforms/merge | POST |
| /api/platforms | DELETE,GET,POST,PUT |
| /api/precious-metals | DELETE,GET,POST,PUT |
| /api/precious-metals/sales | DELETE,GET,POST |
| /api/precious-metals/spot | GET,POST |
| /api/preferences/clear-data | DELETE,GET,POST |
| /api/prices/refresh | POST |
| /api/private-equity | DELETE,GET,POST,PUT |
| /api/real-estate/estimate/address | POST |
| /api/real-estate/geocode | POST |
| /api/real-estate/indirect | DELETE,GET,POST |
| /api/real-estate/properties/[id]/characteristics | PATCH |
| /api/real-estate/properties/[id]/fiscal | PATCH |
| /api/real-estate/properties/[id]/valuation | GET,POST |
| /api/real-estate/properties | GET,POST |
| /api/real-estate/rent-schedule | GET,POST |
| /api/savings/accrue | POST |
| /api/savings | DELETE,GET,POST,PUT |
| /api/securities/accounts/[id]/contributions | GET,POST |
| /api/securities/accounts/[id] | DELETE,PATCH |
| /api/securities/accounts | POST |
| /api/securities/contributions/[id] | DELETE |
| /api/securities/positions | PATCH |
| /api/tangibles/[id]/valuations | DELETE,GET,POST |
| /api/tangibles | DELETE,GET,POST,PUT |
| /api/tax/marginal-rate | GET,PUT |
| /api/term-deposits/[id] | DELETE,PATCH |
| /api/term-deposits | GET,POST |
| /api/trading/accounts/[id] | DELETE,PATCH |
| /api/trading/accounts | POST |
| /api/trading/positions | PATCH |
| /api/transactions | DELETE,GET,POST,PUT |
| /api/wallets/monero/sync | POST |
| /api/wallets/solana/sync | POST |
| /api/wallets/zerion/sync | POST |

## cron (1)

| Chemin | Méthodes |
|---|---|
| /api/cron/collect-intraday | GET,POST |

## read (32)

| Chemin | Méthodes |
|---|---|
| /api/alternatives/summary | GET |
| /api/assets/[id]/history | GET |
| /api/assets/search | GET |
| /api/auth/me | GET |
| /api/banks/[id]/events | GET |
| /api/banks/summary | GET |
| /api/benchmark | GET |
| /api/crypto/defi/portfolio | GET |
| /api/crypto/defi | GET |
| /api/crypto/nft/portfolio | GET |
| /api/crypto/nft/positions/[assetId]/events | GET |
| /api/crypto/spot/history | GET |
| /api/crypto/summary | GET |
| /api/earnings | GET |
| /api/employee-savings/template | GET |
| /api/fx | GET |
| /api/health | GET |
| /api/holdings | GET |
| /api/import/template | GET |
| /api/life-insurance/performance | GET |
| /api/macro | GET |
| /api/market/quotes | GET |
| /api/news | GET |
| /api/patrimony-state | GET |
| /api/platforms/blockchain-defaults | GET |
| /api/precious-metals... (voir write, GET aussi exposé) | — |
| /api/real-estate/estimate | GET |
| /api/real-estate/tax | GET |
| /api/savings/[id]/events | GET |
| /api/securities | GET |
| /api/tax/fiscal-year | GET |
| /api/trading | GET |
| /api/wallets/solana/transactions | GET |

## auth-special (1)

| Chemin | Note |
|---|---|
| /api/auth/[...nextauth] | Handler NextAuth (GET/POST délégués au framework, pas de fonction nommée exportée) |

**Couverture :** 108/108 routes catégorisées (100%).
