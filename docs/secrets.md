# Secrets & hygiène de configuration — Patrimo

## Principes

1. **Aucun secret réel dans le dépôt** (mots de passe, `AUTH_SECRET`, clés API privées).
2. Les secrets vivent dans **`.env`** (local), **variables d’environnement** (CI / Vercel), ou un gestionnaire de secrets.
3. **`.env` est gitignoré** ; seul **`.env.example`** est versionné (placeholders vides).
4. Les logs ne doivent **jamais** afficher de mots de passe ni de tokens.

## Variables obligatoires

| Variable | Usage | Requis |
|----------|--------|--------|
| `DATABASE_URL` | Prisma / PostgreSQL | Oui |
| `AUTH_SECRET` | NextAuth JWT | Oui (prod / démarrage auth) |
| `ADMIN_PASSWORD` | Seed compte admin | Oui pour `npm run db:seed` |
| `DEMO_PASSWORD` | Seed compte demo | Oui pour `npm run db:seed` |

| Variable | Usage | Requis |
|----------|--------|--------|
| `ADMIN_USERNAME` / `ADMIN_EMAIL` | Identité admin seed | Non (défauts publics) |
| `DEMO_USERNAME` / `DEMO_EMAIL` | Identité demo seed | Non (défauts publics) |
| `E2E_USER` / `E2E_PASS` | Playwright | `E2E_PASS` ou `DEMO_PASSWORD` |
| `FINNHUB_API_KEY` | Cours / earnings | Non |
| `COINGECKO_API_KEY` | Crypto (CoinGecko **Demo**, clé `CG-…`) | Non |
| `SOLANA_RPC_URL` | RPC Solana natif (défaut mainnet-beta public) | Non |
| `CRON_SECRET` | Accrual multi-user | Non |
| `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` | Logos (publishable) | Non |

## Bootstrap local

```powershell
Copy-Item .env.example .env
# Éditer .env : AUTH_SECRET, ADMIN_PASSWORD, DEMO_PASSWORD, E2E_PASS
openssl rand -base64 32   # pour AUTH_SECRET
npm run db:seed
```

Si `ADMIN_PASSWORD` ou `DEMO_PASSWORD` manque, le seed **échoue explicitement** avec un message clair (`app/lib/env/seed-credentials.ts`).

## Rotation

| Événement | Action |
|-----------|--------|
| Fuite suspectée / commit accidentel | Changer **immédiatement** le secret concerné ; invalider sessions (`AUTH_SECRET` nouveau = toutes sessions invalidées). |
| Départ collaborateur | Rotation `ADMIN_PASSWORD`, `AUTH_SECRET`, clés API. |
| Périodique (prod) | Rotation `AUTH_SECRET` et mots de passe admin au moins tous les 90 jours. |
| Après seed en prod de test | Utiliser des mots de passe **distincts** du local ; ne pas réutiliser des fixtures CI. |
| Playwright / e2e | Seed e2e = **wipe compte `demo` uniquement** (admin préservé). Pour isoler totalement : `DATABASE_URL_E2E` dans `.env.e2e` (voir `.env.e2e.example`). Ne stockez pas votre patrimoine perso sur le compte `demo`. |

### Rotation `AUTH_SECRET`

1. Générer une nouvelle valeur (`openssl rand -base64 32`).
2. Mettre à jour l’env de déploiement.
3. Redéployer — les utilisateurs devront se reconnecter.

### Rotation mots de passe seed / comptes

1. Mettre à jour `ADMIN_PASSWORD` / `DEMO_PASSWORD` dans l’env.
2. Relancer `npm run db:seed` (upsert des hash) **ou** changer le mot de passe via l’UI admin / `change-password`.
3. Mettre à jour `E2E_PASS` si les e2e utilisent le compte demo.

## CI

- Workflow `.github/workflows/ci.yml` : mots de passe **fixtures CI uniquement** (`ci-only-…`), jamais des secrets de prod.
- Job **Secret scan** (Gitleaks) : échoue si un secret haute entropie / pattern connu apparaît dans le diff.

## Checklist avant déploiement (test → deployable)

Voir aussi **[docs/readiness.md](readiness.md)** (décision déployable + health).

- [ ] `.env` / secrets Vercel renseignés (pas de valeurs d’exemple).
- [ ] `ALLOW_DEMO_FALLBACK=false` hors démo pure.
- [ ] `AUTH_SECRET` unique et fort.
- [ ] `AUTH_URL` / `NEXTAUTH_URL` = URL publique de l’env test.
- [ ] Mots de passe admin/demo **différents** du CI et du local.
- [ ] Clés Finnhub / CoinGecko en variables serveur uniquement (pas `NEXT_PUBLIC_`). `SOLANA_RPC_URL` = URL RPC (pas de secret Solscan).
- [ ] Scan Gitleaks vert sur la branche.
- [ ] `GET /api/health` → `ok: true`, `env.authSecretConfigured: true`.
- [ ] Seed **one-shot** après migrate (pas `db push --accept-data-loss`).
- [ ] Aucun log applicatif ne dump `password`, `Authorization`, ni body login.

## Fichiers de référence

- `app/lib/env/seed-credentials.ts` — chargement + garde-fous
- `prisma/seed.ts` — seed sans log de mot de passe
- `.env.example` — modèle
- `.github/workflows/ci.yml` — env CI + gitleaks
