# Workflow cloud de test — correctifs

Objectif : appliquer et valider les correctifs sur un **environnement cloud réaliste**, sans toucher la production, et permettre à des **testeurs de confiance** de valider via une URL preview.

---

## Cartographie des environnements

| Couche | Production | Staging / Preview (test) | Local |
|--------|------------|---------------------------|-------|
| **Git** | `staging` (default) → merge après validation | branches `fix/*`, `feat/*`, PR vers `staging` | checkout branche |
| **Vercel** | Production (`patrimo-psi.vercel.app`) | **Preview** auto (chaque branche / PR) | `npm run dev` |
| **Neon** | branche `production` | branche **`staging`** (`br-odd-wildflower-as7qdjg8`) | Docker / local Postgres |
| **DATABASE_URL** | Vercel *Production* (sensitive) | Vercel *Preview* → Neon **staging** | `.env` localhost |
| **AUTH_SECRET** | unique prod | unique preview | `.env` local |
| **AUTH_URL** | URL prod fixe | **non défini** (trustHost = host de la preview) | localhost |

### Règles d’or

1. **Jamais** de correctif risqué testé uniquement en prod.
2. **Jamais** de sandbox de validation sur la DB production (écriture testeurs).
3. Une **demande** → une **branche** → une **preview URL** → des **retours** → merge.
4. Git author email = email GitHub vérifié (`pakkof13@gmail.com`), sinon Vercel **BLOCKED**.

---

## Mode opératoire (10 étapes)

### 1. Prendre une demande
Référencer le ticket / doc / capture (ex. `docs` Word, issue GitHub).

### 2. Branche dédiée
```bash
git checkout staging
git pull origin staging
git checkout -b fix/sujet-court
```
Convention de nommage :
- `fix/<sujet>` — bug
- `feat/<sujet>` — amélioration
- `chore/<sujet>` — tooling / workflow

### 3. Appliquer le correctif + garde-fous locaux
```bash
npm run typecheck          # ou npx tsc --noEmit
npx vitest run path/to/test
# npm run build            # si touché build / prisma / next config
```

### 4. Commit propre
```bash
git config --local user.email "pakkof13@gmail.com"
git config --local user.name "pakkof13-a11y"
git add -A   # sans .env ni .tmp-*
git commit -m "fix(scope): description courte"
```

### 5. Push
```bash
git push -u origin HEAD
```

### 6. Preview Vercel
- GitHub → Vercel crée automatiquement une **Preview** pour la branche / PR.
- URL du type : `https://patrimo-<hash>-pakkof13-a11ys-projects.vercel.app`
- Build : `prisma migrate deploy && npm run build` (schéma Neon staging).
- **DB** : Neon branche `staging` (isolée de la prod).

### 7. Vérifier sur le cloud
Checklist flux critiques (compte **demo** / **admin** de l’env staging) :
- [ ] Login
- [ ] Sources / plateformes (menu ⋯, aperçu, new-tx, filtre Positions)
- [ ] Positions (détail multi-plateformes, filtre plateforme)
- [ ] Transactions
- [ ] Import CSV (format, auto-plateforme, DnD)
- [ ] Wallet / blockchain (si clés API présentes en preview)
- [ ] Préférences / avatar / navigation

Health : `GET /api/health` → `ok` + `db: ok`.

### 8. Partager aux testeurs
Message type :
```
Preview : https://patrimo-….vercel.app
Branche : fix/…
Commit  : abc1234
Périmètre test : …
Compte  : demo (mot de passe fourni hors bande / 1Password)
DB      : Neon staging (pas la prod)
```

### 9. Itérer
Même branche : nouveaux commits → nouvelles previews (ou redeploy).

### 10. Merge après validation
```bash
# PR GitHub staging ← fix/…
gh pr create --base staging --head fix/sujet-court --title "…" --body "…"
# après review + OK testeurs
gh pr merge --squash
```
Production se met à jour via le pipeline / deploy sur `staging` (ou `vercel --prod` si besoin).

---

## Neon — branches

| Branche Neon | Usage |
|--------------|--------|
| `production` (default, primary) | App production Vercel uniquement |
| `staging` | Previews Vercel + tests manuels cloud |

Créer / rafraîchir staging depuis production (console Neon ou MCP) :
```text
Parent = production → branch name = staging
```
Puis :
```bash
# Avec STAGING_DATABASE_URL (connection string branche staging)
npx prisma migrate deploy
# seed optionnel (SEED_LIGHT=1) si besoin de données fraîches demo
```

Script d’aide (Preview env Vercel) :
```bash
# API recommandée (CLI interactive « git branch » est fragile)
# Voir scripts/setup-vercel-preview-env.mjs + docs ops
export STAGING_DATABASE_URL="postgresql://…staging-pooler…/neondb?sslmode=require"
# Ré-appliquer via API si variables preview manquantes
```

---

## Variables d’environnement (séparation)

| Variable | Production | Preview | Development |
|----------|------------|---------|-------------|
| `DATABASE_URL` | Neon **production** | Neon **staging** | local ou Neon dev |
| `AUTH_SECRET` | unique | unique | local |
| `AUTH_URL` / `NEXTAUTH_URL` | `https://patrimo-psi.vercel.app` | **omit** (trustHost) | localhost |
| `ALLOW_DEMO_FALLBACK` | `false` | `false` | selon besoin |
| Clés API (Finnhub, Zerion…) | prod keys si besoin | **clés démo / limitées** | local |
| `ZERION_API_KEY` | **requis** pour Base/EVM | **requis** (Preview) | optionnel si clé saisie UI |
| `SOLANA_RPC_URL` | **recommandé** (RPC dédié) | **recommandé** | optionnel (public rate-limité) |
| `SOLSCAN_API_KEY` | optionnel (dates txs) | optionnel | optionnel |
| `COINGECKO_API_KEY` | Monero méta | Monero méta | optionnel |

Ne jamais copier les secrets prod dans le dépôt.  
Ne pas committer `.env`, `.env.production.local`, `.env.neon`.

---

## Traçabilité demande → validation

| Élément | Où |
|---------|-----|
| Demande | Issue / doc Word / message |
| Branche | `fix/…` |
| Commits | messages conventionnels |
| Preview | commentaire PR Vercel bot + URL |
| Retours testeurs | commentaires PR / fil dédié |
| Merge | PR mergeée vers `staging` |

---

## Distinction claire des URLs

| Env | URL typique |
|-----|-------------|
| **Production** | https://patrimo-psi.vercel.app |
| **Preview (branche)** | https://patrimo-&lt;hash&gt;-pakkof13-a11ys-projects.vercel.app |
| **Local** | http://127.0.0.1:3000 |

---

## Dépannage Vercel BLOCKED

Si pop-up *commit author email is not a valid email* :
```bash
git config --local user.email "pakkof13@gmail.com"
git config --local user.name "pakkof13-a11y"
git commit --allow-empty -m "chore: trigger deploy with valid author"
git push
```
Email = celui **vérifié** sur le compte GitHub.

---

## CI

Workflow `.github/workflows/ci.yml` : typecheck, unit, build (+ e2e si configuré).  
Branches cibles : `staging`, `main`, PRs.

Les previews Vercel restent le **canal principal** de validation fonctionnelle pour les testeurs (pas uniquement CI).
