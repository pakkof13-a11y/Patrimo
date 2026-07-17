# API Transactions — pagination serveur

## `GET /api/transactions`

### Query params

| Param | Défaut | Description |
|-------|--------|-------------|
| `page` | `1` | Page **1-based** |
| `pageSize` | `50` | Taille (max **100**) |
| `typeGroup` | `all` | Famille : `all`, `buy`, `sell`, `dividend`, `fees`, `cash`, `transfer`, `split` |
| `type` | — | Type exact Prisma (`ACHAT`, …) — prioritaire sur `typeGroup` |
| `accountType` | — | Enveloppe (`CTO`, `PEA`, …) via `asset.accountType` |
| `q` | — | Recherche (notes, type, devise, nom/ticker/ISIN actif, plateforme) |

### Réponse

```json
{
  "transactions": [ /* page courante, select minimal */ ],
  "total": 42,
  "totalAll": 103,
  "page": 1,
  "pageSize": 50,
  "pageCount": 1,
  "typeCounts": { "all": 42, "buy": 10, "sell": 5 }
}
```

| Champ | Sens |
|-------|------|
| `total` | Nombre de lignes **après filtres** |
| `totalAll` | Total user **sans filtre** |
| `typeCounts` | Comptes par famille pour chips (mêmes filtres enveloppe/q, **sans** typeGroup) |

### Payload allégée

Plus d’`include: { asset: true, … }` complet : `select` explicite (champs journal + relations minimales).

### Client React Query (source de vérité unique)

| Hook | Clé | Usage |
|------|-----|--------|
| `useTransactionsListQuery(params)` | `["transactions","list", …]` | Journal paginé (`TransactionsTab`) |
| `useTransactionsMetaQuery()` | `["transactions","meta"]` | `totalAll` pour maturité dashboard |

- **Pas de `fetch()` local** dans le journal — invalidation `queryKey: ["transactions"]` après CRUD (shell, import, clear-data).
- Ancien appel `GET /api/transactions` sans params → **page 1, 50 lignes**.

### Performances (gros volumes)

- Pagination SQL `skip`/`take` + `count` filtré.
- Index recommandés déjà présents sur `(userId)`, utile d’ajouter éventuellement `(userId, occurredAt DESC)` en migration future.
