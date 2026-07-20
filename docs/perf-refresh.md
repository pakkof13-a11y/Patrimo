# Stratégie de fraîcheur vs charge — prix & alternatifs

## Auto-refresh des prix

| Paramètre | Valeur | Raison |
|-----------|--------|--------|
| Intervalle | **60 s** (`PRICE_AUTO_REFRESH_MS`) | Compromis fraîcheur / charge providers (était 10 s, puis 90 s) |
| Onglets | Leader only (`localStorage` lock ~25 s) | Multi-onglets = 1 POST `/api/prices/refresh` |
| Visibility | Pause si `document.hidden` | Pas de charge en arrière-plan |
| Vues | Dashboard, Positions, Transactions | Fiscal / passifs / AV : pas d’auto-tick |
| Backoff | 60 s × 2ⁿ (max 10 min) après échecs | Évite la tempête d’erreurs Prisma/API |
| Followers | `BroadcastChannel` → `reloadHoldings` | Fraîcheur UI sans re-hit providers |

**Manuel** : bouton « Actualiser les prix » reste disponible partout (toast non silencieux).

**Stale data** : au retour d’onglet, refresh si le dernier sync date de plus de ~45 s (moitié d’intervalle). Les followers ne croient pas un cache plus vieux qu’un event leader.

## Dashboard Alternatifs

| Avant | Après |
|--------|--------|
| 5 HTTP au mount (metals + PE + CL + tangibles + summary) | **1 HTTP** `GET /api/alternatives/summary` (bundle) |
| Listes toujours chargées | Listes **lazy** quand `sub === metals|…` |

`?lite=1` sur le même endpoint : slice EUR seul (compat holdings / net-worth si besoin).

`staleTime` dashboard : 60 s (réactif sans refetch agressif).

## Arbitrages

1. **90 s de latence max** sur les cours auto vs charge Yahoo/CG/Finnhub et DB.
2. **Leader tab** = best-effort (localStorage) — multi-device non coordonné (acceptable pour un compte perso).
3. **Bundle alternatifs** = plus de travail serveur ponctuel, mais moins de round-trips navigateur (goulot principal en test déployé).
