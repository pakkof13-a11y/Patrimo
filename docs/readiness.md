# Readiness — environnement de test séparable / déployable

**Date de passe :** 2026-07-17  
**Périmètre :** testeurs externes limités, env stable, risque réduit — **pas** un lancement public mass-market.

## Décision

### ✅ **Déployable en environnement de TEST** (avec actions manuelles)

Raisons :
- Auth multi-couches (middleware + `requireUserId` / `gateAdmin` DB)
- Secrets hors dépôt ; seed échoue sans mots de passe
- CI : gitleaks + typecheck + unit + build + e2e
- Isolation multi-tenant renforcée (écritures `userId`, CUMP fiscal multi-plateforme)
- Validation Zod PUT/PATCH homogénéisée sur routes critiques
- Health public sans fuite d’erreur DB en déployé
- `vercel.json` n’utilise plus `db push --accept-data-loss`

### ❌ **Non recommandé pour production grand public** sans travail supplémentaire

Raisons (surveillance / backlog) :
- Rate-limit login **in-memory** (multi-instance = non partagé)
- Sessions JWT 30 j sans soft-delete / flag `active` utilisateur
- Lint CI encore `continue-on-error`
- Pas de CSP stricte, pas de WAF, pas de secrets manager managé
- Accrual cron dépend d’un secret partagé ; pas de queue durable

---

## Checklist structurée

### OK (vert)

| Domaine | État |
|---------|------|
| Routes publiques | Allowlist : `/login`, `/api/auth/*`, `/api/health`, assets statiques |
| API métier | `requireUserId` ; admin `gateAdmin` revalide le rôle en DB |
| Login | Rate-limit + message générique + bcrypt dummy |
| Secrets seed | `ADMIN_PASSWORD` / `DEMO_PASSWORD` requis, pas de hardcode |
| CI secrets | Gitleaks + fixtures `ci-only-*` |
| Health | DB ping + flags config ; pas de détail erreur DB hors dev local |
| CRON accrue | Comparaison timing-safe `CRON_SECRET` |
| Build Vercel | `prisma migrate deploy` + `npm run build` (pas de data-loss) |
| Headers basiques | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| Docs | `README`, `docs/secrets.md`, `docs/api-routes-auth.md` |
| Tests | Vitest unitaires + Playwright e2e en CI |

### À surveiller (ambre)

| Point | Risque | Mitigation test |
|-------|--------|-----------------|
| Rate-limit mémoire (login, benchmark) | Bypass si multi-instance | 1 instance pour l’env test ; OK |
| JWT 30 jours | Compte hard-deleted → 401 via `assertUserActive` ; pas de soft-delete | Supprimer le user = isolation OK |
| Lint non bloquant en CI | Dette style | `npm run lint` manuellement avant release |
| `trustHost: true` NextAuth | Host header en mauvaise config reverse-proxy | Fixer `AUTH_URL` / `NEXTAUTH_URL` en env |
| Clés marché absentes | Cours manuels / dégradés | Optionnel pour test fonctionnel |
| Logs applicatifs | Console serveur standard | Ne pas activer debug body login |

### Bloquants restants (pour **prod publique**)

| Bloquant | Action si un jour prod large |
|----------|------------------------------|
| Rate-limit partagé (Redis/Upstash) | Avant multi-région |
| Soft-delete / `User.active` | Avant conformité comptes |
| Monitoring & alerting (Sentry, uptime) | Avant SLA |
| CSP + cookies `Secure` audit reverse-proxy | Avant exposition large |
| Backup DB automatisé | Avant données réelles critiques |

---

## Actions manuelles avant déploiement test

1. **Créer un projet / env séparé** (Vercel preview, Railway, VPS) — **jamais** la DB locale de dev.
2. **Variables** (cf. `.env.example` + `docs/secrets.md`) :
   - `DATABASE_URL` (Postgres managé)
   - `AUTH_SECRET` (fort, unique à cet env)
   - `AUTH_URL` / `NEXTAUTH_URL` = URL publique de l’env test
   - `ADMIN_PASSWORD` / `DEMO_PASSWORD` **distincts** du local et du CI
   - `ALLOW_DEMO_FALLBACK=false`
   - `CRON_SECRET` si cron accrual (min. 16 car.)
   - Clés Finnhub / CoinGecko si cours live souhaités
3. **Migrations** : `npx prisma migrate deploy` (déjà dans `vercel.json` build).
4. **Seed une fois** (pas à chaque build) : `npm run db:seed` via job one-shot ou shell.
5. **Vérifier** `GET /api/health` → `ok: true`, `env.authSecretConfigured: true`, `configOk: true`.
6. **Smoke** : login demo/admin, holdings, une transaction, logout.
7. **Gitleaks / CI vert** sur la branche déployée.

### Commandes utiles

```powershell
npm run ready:check   # typecheck + unit
npm run ci:local      # + build
npm run test:e2e      # si stack locale up
```

---

## Surfaces sensibles — cohérence

| Surface | Protection |
|---------|------------|
| `/api/*` métier | Middleware session + `requireUserId` |
| `/api/admin/users` | `gateAdmin` (DB role) |
| `/api/benchmark` | Auth + rate-limit + cache |
| Templates CSV | Auth |
| `/api/savings/accrue` | Session **ou** CRON secret timing-safe |
| `/api/health` | Public, payload non sensible en déployé |
| `/api/auth/*` | NextAuth |

---

## Fichiers touchés dans cette passe readiness

- `app/lib/env/runtime.ts` — flags config + compare secrets
- `app/api/health/route.ts` — health enrichi / safe
- `app/api/savings/accrue/route.ts` — timing-safe cron
- `vercel.json` — migrate deploy sans data-loss
- `next.config.ts` — headers sécurité basiques
- `.env.example` — notes deploy
- `package.json` — `ready:check`
- `docs/readiness.md` — ce document
