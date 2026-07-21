# Audit sécurité — correctifs (juil. 2026)

Réponses aux findings process-local rate-limit, cache accès, CSP, trustHost.

| Finding | Correctif | Fichiers |
|---------|-----------|----------|
| Rate-limit mémoire multi-instance | Store **Upstash Redis** (`kv-store`) + fallback mémoire local/tests | `app/lib/api/kv-store.ts`, `simple-rate-limit.ts`, `login-rate-limit.ts` |
| Cache accès user process-local | Pas de cache mémoire sur Vercel sans Upstash ; Redis TTL 30 s si Upstash ; **`gateAdmin` always bypassCache** | `app/lib/auth-helpers.ts` |
| Pas de CSP | Header `Content-Security-Policy` + HSTS | `next.config.ts` |
| `trustHost: true` permanent | `resolveAuthTrustHost()` — off si `AUTH_URL`, on preview Vercel | `app/lib/auth/trust-host.ts`, `auth.ts` |

## Ops post-deploy

1. Vercel Production : `AUTH_URL=https://patrimo-psi.vercel.app`
2. Vercel Production + Preview : `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
3. Vérifier `GET /api/health` → `rateLimitBackend: "upstash"`, `authUrlConfigured: true` (prod)
