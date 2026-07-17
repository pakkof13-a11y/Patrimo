# Routes API — auth publique vs privée

Protection en **deux couches** :

1. **Middleware NextAuth** (`proxy.ts` + `auth.ts` → `callbacks.authorized`)
2. **`requireUserId` / `requireAdmin`** dans le handler (defense-in-depth, 401 JSON)

## Routes publiques intentionnelles

| Route | Raison produit |
|-------|----------------|
| `GET/POST /api/auth/*` | NextAuth (login, CSRF, session, callback) |
| `GET /api/health` | Healthcheck e2e / monitoring (pas de données user) |
| `/login` (page) | Formulaire de connexion |

### Login / brute-force

- Rate-limit **mémoire** par **IP** + **identifiant** (`app/lib/auth/login-rate-limit.ts`).
- Après 5 échecs / 15 min : cooldown progressif (45 s → plafonné 15 min).
- Erreurs **génériques** (pas de distinction user / mot de passe).
- Comparaison bcrypt factice si user inconnu (réduit timing leak).
- Succès → reset des compteurs pour IP + login.

Tout le reste du matcher middleware exige une session (`!!session?.user`).

## Routes privées (session requise)

Toutes les autres routes sous `/api/**`, notamment :

- Portefeuille, holdings, transactions, platforms, assets, banks, savings…
- Alternatifs, épargne salariale, fiscalité, import…
- **`GET /api/benchmark`** — proxy Yahoo indices (auth + cache + rate-limit)
- Templates CSV (`/api/import/template`, `/api/employee-savings/template`)

Admin uniquement : `/api/admin/users` (`gateAdmin` — rôle **revalidé en base**, cache ≤ 30 s).

### Rôle ADMIN et session JWT

| Couche | Comportement |
|--------|----------------|
| JWT / session | `role` est **indicatif** (posé à la connexion) |
| `gateAdmin()` / `requireAdmin()` | Relit `User.role` en PostgreSQL (TTL cache 30 s) |
| Compte supprimé | `assertUserActive` / `loadUserAccess` → 401 « Session invalide » |
| USER qui était ADMIN | 403 dès la prochaine revalidation DB (≤ 30 s, pas 30 jours) |

Invalidation cache : `invalidateUserAccessCache(userId)` après suppression / changements sensibles.


## Cas particulier

| Route | Note |
|-------|------|
| `POST /api/savings/accrue` | Session user **ou** `Authorization: Bearer $CRON_SECRET` / header `x-cron-secret` pour traitement multi-user |

## Middleware vs handler

- Middleware seul : sans cookie → redirection login (HTML), peu adapté aux clients API.
- Handler `requireUserId` : **401 JSON** `{ error: "Non authentifié" }` — correct pour fetch XHR.

Toujours appeler `requireUserId` (ou `requireAdmin`) dans les handlers sensibles, même si le middleware couvre déjà la route.
