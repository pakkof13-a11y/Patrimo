# Patrimo — Suivi de patrimoine

Application locale de suivi d’investissements (actions, crypto, immobilier, cash multi-plateformes).

**Règle centrale :** les **transactions** sont la source de vérité immuable. Quantités, CUMP, cash plateformes, P&L et KPIs sont **dérivés**, jamais stockés comme totaux éditables indépendants.

> Les calculs affichés sont des **estimations** et ne constituent **pas** un conseil fiscal.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS + composants type shadcn/ui
- PostgreSQL + Prisma
- Auth.js (NextAuth v5) — identifiants
- TanStack Query / Table, Recharts, React Hook Form + Zod
- Decimal.js pour tous les montants et quantités
- Vitest (unitaires) + Playwright (E2E critique)

## Readiness (env de test)

Voir **[docs/readiness.md](docs/readiness.md)** pour la checklist déploiement test,
les garde-fous secrets et la décision **déployable / non déployable**.

### Workflow cloud de correction (preview + Neon staging)

Voir **[docs/cloud-test-workflow.md](docs/cloud-test-workflow.md)** :

- branches `fix/*` / `feat/*` → preview Vercel automatique ;
- base **Neon `staging`** (isolée de la prod) pour les previews ;
- validation par testeurs de confiance sur URL partageable avant merge sur `staging`.

```powershell
npm run ready:check   # typecheck + unitaires
```

## Prérequis Windows (PowerShell)

- Node.js 22+ (`node -v`, `npm -v`)
- PostgreSQL 16+ **ou** Docker Desktop
- (Optionnel) Git pour déployer sur Vercel

## Installation

```powershell
cd C:\Users\Pak-M\projects\patrimo
npm install
```

### Variables d’environnement

```powershell
# Ne pas écraser un .env existant s’il contient déjà des secrets
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Éditer .env : DATABASE_URL, AUTH_SECRET, COINGECKO_API_KEY (optionnel)
```

Générez un secret Auth :

```powershell
# Exemple PowerShell
$secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
Write-Host $secret
```

### Base de données — Docker (recommandé)

```powershell
docker compose up -d
# DATABASE_URL par défaut dans .env.example :
# postgresql://patrimo:patrimo@localhost:5432/patrimo?schema=public
```

### Base de données — PostgreSQL Windows (sans Docker)

1. Installer PostgreSQL (ex. via winget : `PostgreSQL.PostgreSQL.17`).
2. Créer le rôle et la base :

```powershell
# Adapter le chemin bin si besoin
$env:Path = "C:\Program Files\PostgreSQL\17\bin;" + $env:Path
# En tant que superutilisateur postgres (mot de passe d’installation) :
psql -U postgres -h 127.0.0.1 -c "CREATE USER patrimo WITH PASSWORD 'patrimo' CREATEDB;"
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE patrimo OWNER patrimo;"
psql -U postgres -h 127.0.0.1 -d patrimo -c "GRANT ALL ON SCHEMA public TO patrimo; ALTER SCHEMA public OWNER TO patrimo;"
```

3. Renseigner `DATABASE_URL` dans `.env`.

### Migrations + seed

```powershell
npx prisma migrate deploy
# Après toute migration : ARRÊTER next dev, puis régénérer le client Prisma
npm run db:regen
npm run db:seed
```

⚠️ **`npm run db:seed` efface** transactions, actifs, plateformes, cash, alternatives,
épargne salariale, etc. pour le compte démo — puis laisse un compte **vide** (aucune
plateforme pré-créée). Les presets restent disponibles uniquement à l’ajout manuel.

Optionnel — injecter les blockchains en base (sinon elles ne sont que des presets UI) :

```powershell
npm run db:seed-blockchains
```

Comptes bootstrap (seed) :

- Définis via **`.env`** : `ADMIN_PASSWORD`, `DEMO_PASSWORD` (obligatoires pour le seed).
- Identifiants publics par défaut : `demo` / `demo@patrimo.fr`, `admin` / `admin@patrimo.local`.
- Voir **`.env.example`** et **`docs/secrets.md`** (aucun mot de passe dans le dépôt).

### Auth locale

NextAuth (Credentials) multi-utilisateur avec isolation `userId`.
Configurer `AUTH_SECRET` avant de démarrer. Ne jamais committer `.env`.

### Client Prisma (erreur `findMany` / 500 holdings)

Si `/api/holdings` renvoie 500 avec *Cannot read properties of undefined (reading 'findMany')* :

```powershell
# 1. Arrêter npm run dev (Ctrl+C) — libère le verrou Windows sur query_engine
# 2. Régénérer
npm run db:regen
# 3. Relancer
npm run dev
```

### Lancer l’application

```powershell
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000)

## Patrimoine net (formule KPI)

```
Patrimoine net =
  Cotés (positions ledger)
+ Cash (poches > 0 : banques, livrets, CTO/PEA/AV, fonds euro AV)
+ Alternatifs (métaux, PE NAV, crowdlending capital en cours, tangibles)
+ Épargne salariale (parts × VL)
− Passifs
```

- **Crowdlending** : seul le capital des prêts `ACTIVE` / `LATE` entre dans le net worth
  (pas les intérêts courus ; remboursés / défaut exclus).
- **P&L latent** KPI : portefeuille **coté** uniquement (CUMP vs marché).

## Qualité & tests

```powershell
npm run lint
npm run typecheck
npm test              # unitaires Vitest
npm run test:e2e      # Playwright (PLAYWRIGHT_REUSE=1 si :3000 déjà pris)
npm run build
npm run ci:local      # typecheck + unit + build
```

### E2E (Playwright)

Prérequis : Postgres démarré, migrations + seed appliqués, puis :

```powershell
npx playwright install chromium
npm run test:e2e
# ou interface interactive
npm run test:e2e:ui
```

Scénarios couverts (`e2e/`) :

| Spec | Contenu |
|------|---------|
| `api-health` | `/api/holdings`, `/api/portfolio`, `/api/transactions` |
| `navigation` | KPI, onglets, filtres CTO/PEA/Crypto |
| `dashboard` | Courbe d’évolution, allocations, refresh prix |
| `purchase-sale` | Achat → cash inchangé → vente → P&L |
| `import-csv` | Template / preview / commit API + modale UI |

### CI GitHub Actions

Workflow `.github/workflows/ci.yml` sur push/PR :

1. Postgres 16 service
2. `prisma migrate deploy` + seed
3. Typecheck + unit tests + build
4. Job E2E Chromium (Playwright) + rapport en artifact si échec

Variables CI injectées : `DATABASE_URL`, `AUTH_SECRET`, `ALLOW_DEMO_FALLBACK=true`.

`DATABASE_URL` en CI pointe vers le service Postgres 16 du job, ex. :
`postgresql://patrimo:patrimo@localhost:5432/patrimo?schema=public` — un
Postgres classique, pas Neon. Le client Prisma (`app/lib/prisma.ts`) détecte
ce cas (URL sans `neon.tech` et hors Vercel) et utilise l'adapter
`@prisma/adapter-pg` (node-postgres, TCP standard) au lieu de l'adapter
`@prisma/adapter-neon` (WebSocket, réservé à la prod Vercel/Neon).

## Architecture comptable (résumé)

| Concept | Comportement |
|--------|----------------|
| CUMP | Coût moyen pondéré **par actif × plateforme** |
| Frais d’achat | Augmentent le coût d’acquisition |
| Frais de vente | Réduisent le produit de cession |
| Dividendes / coupons / loyers / intérêts | + cash plateforme, quantité inchangée |
| Transferts | Déplacent cash ou titres **sans** P&L réalisé |
| Garde-fous | Quantité ou cash négatif → erreur de validation |
| Devises | Devise d’origine + taux FX + montants EUR stockés |
| Horodatage | Stockage UTC, métier Europe/Paris |

## Prix de marché

- **Finnhub** (primaire actions) + **Yahoo Finance** (fallback) + **CoinGecko** (crypto) + manuel
- Suffixes gérés : `.PA`, `.SW`, `.DE`, `.L`, etc.
- Appels **uniquement côté serveur** (`POST /api/prices/refresh`)
- Cache (`PriceQuote`) : prix natif, devise, EUR, source, statut, `lastUpdatedAt`
- Variables : `FINNHUB_API_KEY`, `COINGECKO_API_KEY` (serveur uniquement)
- Bouton **« Actualiser les prix »** + résumé succès/échec

## Logos (Logo.dev)

- Logos entreprises / actions / crypto via [Logo.dev](https://www.logo.dev/docs/logo-images/introduction)
- Variable : `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` (clé publishable, utilisable côté client)
- Lookups : `ticker/MC.PA`, `crypto/BTC`, `name/Boursorama`, domaine `lvmh.com`
- Module : `app/lib/logos/logodev.ts`

## Multi-devises & dark mode

- Devises de reporting : EUR (défaut), USD, CHF (+ conversion live Frankfurter/BCE)
- Badges devise (drapeaux) dans tableaux et formulaires
- Dark mode via `next-themes` (icône soleil/lune)

## Affichage fluide & colonnes

- Conteneur **fluide** : `width: min(95%, max-width)` · plafond configurable (défaut **2560px**)
- Menu **Affichage** (header) : Fluide / Standard 1500 / Wide 1920 / Ultra 2560
- Tableaux **table-fluid** : colonnes avec `min-width`, étirement tant qu’elles tiennent ; `overflow-x: auto` **uniquement** si le cumul dépasse l’écran
- Bouton **Colonnes** sur Positions : show/hide, **drag & drop** (en-têtes + poignées du menu), ordre + visibilité en localStorage (`patrimo.display.columnOrder.holdings.v3`)
- **Redimensionnement colonnes** (type Excel) : glisser le bord droit d’un en-tête · **double-clic** sur le bord = autosize · largeurs en `patrimo.display.columnSizing.holdings.v3` (min 80px)
- Colonnes verrouillées : Actif, Valeur totale · + PRU, cours, P&L, allocation %, frais de transaction, dernière MAJ, dividendes, break-even…

## Intérêts dynamiques (Livrets & Passifs)

### Livrets
- **APR** (linéaire) : `r = R / n` · **APY** (composé) : `r = (1+R)^(1/n) − 1`
- Périodicité : Journalier / Hebdomadaire / Mensuel / Annuel + règle de jour
- Versements **crédités automatiquement** au solde (GET `/api/savings`, bouton « Actualiser les intérêts », cron `POST /api/savings/accrue` avec `CRON_SECRET`)
- Solde affiché = solde crédité + intérêts courus (pro-rata)

### Passifs
- **Taux éditable à la volée** (input inline) → avenant `RATE_CHANGE` + recalcul fin estimée / intérêts restants

## Épargne salariale (PEE / PER / PERCO)

- Onglet **Épargne Salariale** : positions FCPE (parts × VL), ISIN, gestionnaire
- Origine des fonds : versements volontaires, intéressement, participation, abondement
- Liquidité : **Disponible** / **Bloqué** (PEE +5 ans auto depuis date de versement · PER/PERCO = retraite)
- Dashboard : total, barres bloqué/dispo, camemberts plan/gestionnaire, timeline de déblocage
- CRUD + **import CSV** (`/api/employee-savings/template`)

## Import CSV

- Bouton **Import CSV** (en-tête + onglet Transactions)
- Formats : **Auto-détection**, **Modèle Patrimo**, **Générique**, **Binance**, **Boursorama**, **Revolut** (compte / invest), **Coinbase** (Transaction history)
- Flux : fichier → analyse / prévisualisation → sélection des lignes → import
- Actifs manquants créés automatiquement (ticker / nom)
- Modèle téléchargeable : `GET /api/import/template` ou bouton dans la modale
- API : `POST /api/import/preview`, `POST /api/import/commit`
- Historique importé en ordre chronologique avec `allowNegativeCash` pour coller aux exports

Exemple de colonnes modèle Patrimo :

```text
date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class
```

## Évolution du portefeuille

- Snapshots `PortfolioSnapshot` (valeur totale = positions + cash, un point par jour)
- Enregistrés automatiquement à chaque **Actualiser les prix**
- Premier snapshot créé au premier chargement de `/api/portfolio` s’il n’y en a aucun
- Graphique **LineChart** sur le Tableau de bord (valeur totale + cash en pointillés)
- Période : delta € et % affichés en en-tête du graphique
- Multi-devise : conversion des snapshots EUR au taux du jour vers la devise d’affichage

## Plateformes & passifs

- Logos prédéfinis (brokers, exchanges, banques, blockchains) + URL logo custom
- Adresses wallet pour plateformes blockchain
- Onglet **Passifs** : dettes, taux, mensualités
- **Patrimoine net** = actifs (positions + cash) − passifs

## Scripts npm

| Script | Description |
|--------|-------------|
| `npm run dev` | Serveur de développement |
| `npm run build` / `start` | Production |
| `npm run db:migrate` | Migrations Prisma |
| `npm run db:seed` | Seed idempotent |
| `npm test` | Tests unitaires Vitest |
| `npm run test:e2e` | Playwright |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |

## Déploiement Vercel (notes)

1. Installer Git, pousser le dépôt vers GitHub/GitLab.
2. Importer le projet sur [Vercel](https://vercel.com).
3. Provisionner un **PostgreSQL managé** (Neon, Railway, Vercel Postgres, etc.) — **Supabase non requis**.
4. Variables d’environnement Vercel :
   - `DATABASE_URL` (connection pooling + `?sslmode=require` si besoin)
   - `AUTH_SECRET` (secret fort)
   - `AUTH_URL` / `NEXTAUTH_URL` = URL de production
   - `COINGECKO_API_KEY` (optionnel)
5. Build Vercel : `npm run build` uniquement (`vercel.json` → `buildCommand`).
   **Migrations : ne pas les lancer depuis le build runner Vercel.**
   `prisma migrate deploy` sur la base de production depuis un build (sans
   backup automatique, sans rollback si le build échoue à mi-chemin) est
   risqué — un build interrompu peut bloquer TOUT déploiement derrière lui.
   Exécuter manuellement avant le déploiement, ou via un workflow CI/CD dédié
   avec accès sécurisé à `DATABASE_URL` :

   ```text
   npx prisma migrate deploy --schema=./prisma/schema.prisma
   # équivalent : npm run db:deploy
   ```

6. Ne jamais exposer `COINGECKO_API_KEY` ni `AUTH_SECRET` côté client.

## Structure utile

```text
app/page.tsx              # Orchestrateur (données, mutations, routing d’onglets)
app/lib/api-client.ts     # fetchJson + reloadHoldings
app/lib/types/ui.ts       # Types UI partagés (Holding, MainTab…)
app/lib/accounting/       # CUMP + ledger (Decimal)
app/lib/market/           # Fournisseurs de prix
app/lib/portfolio/        # Holdings & KPIs + snapshots
components/
  layout/app-header.tsx
  dashboard/              # KPI strip + tableau de bord (courbes)
  holdings/               # Tableau TanStack positions
  transactions/           # Journal
  platforms/              # Cartes plateformes
  modals/                 # Transaction, plateforme, détail actif
  tabs/                   # Banques, AV, passifs, enveloppes
  ui/                     # Modal, Field, Kpi, boutons…
prisma/schema.prisma
tests/unit/
e2e/
docker-compose.yml
.env.example
```

## Licence

Usage personnel / projet local.
