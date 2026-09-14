# audit-env — .env.example, secrets critiques

Aucun constat.

Vérifications faites (FINNHUB_API_KEY, CRON_SECRET, AUTH_SECRET, UPSTASH_REDIS_REST_URL/TOKEN, DATABASE_URL, ALLOW_DEMO_FALLBACK) :
- CRON_SECRET absent → timingSafeEqualSecret renvoie false (expected absent ou <8 car.) → les 2 handlers cron (collect-intraday, savings/accrue) répondent 401, n'écrivent rien.
- AUTH_SECRET absent → assertAuthSecretConfigured throw en production ; @auth/core (assert.js) renvoie MissingSecret indépendamment, à chaque requête d'auth, quel que soit l'environnement — échec explicite, jamais une session qui s'ouvre.
- FINNHUB_API_KEY absent/placeholder → getApiKey()/hasFinnhubApiKey() renvoient null/false → repli documenté et testé vers Yahoo (prix)/Google News RSS/mock (actus), jamais d'appel réseau avec clé invalide.
- UPSTASH_REDIS_REST_URL/TOKEN absents → kv-store.ts bascule sur Map process-local, avertissement explicite si multi-instance, signalé aussi par /api/health (non bloquant).
- DATABASE_URL absent → échec explicite à la requête (pas silencieux), remonté par /api/health (db:"error", 503).
- ALLOW_DEMO_FALLBACK : lu uniquement pour signaler configIssues/503 sur /api/health en environnement déployé ; ne conditionne aucun contournement d'auth ou de compte demo dans le code actuel.

Fichiers consultés : .env.example, app/lib/env/runtime.ts, app/lib/auth/startup-check.ts, auth.ts, app/lib/auth/cron-credential.ts, app/api/cron/collect-intraday/route.ts, app/api/savings/accrue/route.ts, app/lib/market/providers/finnhub.ts, app/lib/news/news-live.ts, earnings-live.ts, app/lib/api/kv-store.ts, app/lib/prisma.ts, app/api/health/route.ts.
