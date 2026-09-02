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
| `GET /api/cron/collect-intraday` | `$CRON_SECRET` **uniquement** — déclenché par Vercel Cron, qui appelle en GET. Aucun repli session : aucun écran ne peut l'atteindre |
| `POST /api/cron/collect-intraday` | Session user (amorçage / diagnostic) **ou** `$CRON_SECRET` pour tous les comptes |

### Dispense de session pour les tâches planifiées

Le proxy (`auth.ts`, callback `authorized`) couvre `/api/**` et redirige vers
`/login` toute requête sans session. Une tâche Vercel Cron n'en a pas : elle
n'apporte qu'un en-tête. `POST /api/savings/accrue` était donc redirigé en 307
**même avec le bon secret**, et ce cron n'a jamais pu s'exécuter.

`isCronPath(path) && hasCronCredential(request)` lève la redirection sur les
seuls chemins de cron — `/api/cron/**` et la route historique des livrets. La
dispense ne juge que la **forme** de la requête : le handler compare le secret
en temps constant (`timingSafeEqualSecret`) et répond 401 s'il est faux.
Franchir le proxy n'est donc pas être autorisé.

Le secret n'est pas comparé dans le proxy pour deux raisons : `node:crypto` n'y
est pas garanti, et deux comparaisons feraient deux autorités pour une seule
décision.

## Middleware vs handler

- Middleware seul : sans cookie → redirection login (HTML), peu adapté aux clients API.
- Handler `requireUserId` : **401 JSON** `{ error: "Non authentifié" }` — correct pour fetch XHR.

Toujours appeler `requireUserId` (ou `requireAdmin`) dans les handlers sensibles, même si le middleware couvre déjà la route.
