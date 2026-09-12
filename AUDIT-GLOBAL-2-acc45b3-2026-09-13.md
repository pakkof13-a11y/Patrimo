# Audit Global Patrimo — Trous + API Hors Portfolio (Suite Exhaustive)

**Date :** 2026-09-13
**SHA :** acc45b3
**Branche :** feat/audit-w1
**Audit :** Phase 2 Exhaustive (Vagues A, B, C)
**Agents :** 11/11 OK, 0 KO
**Constats confirmés :** 56 (0 P0, 2 P1, 23 P2, 31 P3)

## Inventaire API

**Total routes (hors /api/portfolio/**) :** 108
**write :** 74 · **cron :** 1 · **read :** 32 · **auth-special :** 1
**Orphelines :** 0
**Couverture :** 100% catégorisée (cf. `audit/raw/api-inventory.md`)

## Statut Agents

| Agent | Statut | Fichier | Modèle | Constats |
|---|---|---|---|---|
| audit-fx | ✅ OK | audit/raw/fx.md | Fable High | 10 |
| audit-import | ✅ OK | audit/raw/import.md | Fable High | 15 |
| audit-shell | ✅ OK | audit/raw/shell.md | Fable High | 12 |
| audit-ci | ✅ OK | audit/raw/ci.md | Sonnet High | 0 |
| audit-api-write | ✅ OK | audit/raw/api-write.md | Fable High | 11 |
| audit-api-cron | ✅ OK | audit/raw/api-cron.md | Fable High | 3 |
| audit-api-read | ✅ OK | audit/raw/api-read.md | Sonnet Medium | 0 |
| audit-api-authz | ✅ OK | audit/raw/api-authz.md | Sonnet High | 0 |
| audit-seed | ✅ OK | audit/raw/seed.md | Sonnet Medium | 1 |
| audit-notif | ✅ OK | audit/raw/notif.md | Sonnet Medium | 4 |
| audit-env | ✅ OK | audit/raw/env.md | Sonnet Medium | 0 |

Note : audit-notif a corrigé la doctrine initiale — la fonctionnalité notifications N'EST PAS absente (cloche in-app existe, `app/lib/notifications/**`), seuls email/webhook le sont. Documenté avec preuve glob dans le raw.

## Section 2 — Table P0 & P1 (+ P2 les plus lourds, max 15)

Triée par gravité puis ID.

| ID | Gravité | Fichier:Ligne | Repro | Agent |
|---|---|---|---|---|
| API-W-01 | P1 | crypto/defi/positions/[id]/events/route.ts:163 | Rejeu d'un 400 (date invalide) décrémente l'accru DeFi à chaque tentative, sans événement journalisé | audit-api-write |
| SEED-01 | P1 | prisma/seed-portfolio.ts:2582 | 28,7% des clôtures récentes du seed tombent un week-end (marché fermé) | audit-seed |
| SHELL-10 | P2 | ui/user-avatar-prefs.ts:7 | Clés localStorage non préfixées userId : avatar/vues enregistrées d'un user visibles par le suivant sur le même navigateur | audit-shell |
| IMP-04 | P2 | transactions/service.ts:495 | État ledger mis à jour avant l'insert Prisma ; échec réseau → VENTE écrite sans son ACHAT, aucun rollback | audit-import |
| FX-05 | P2 | market/fx.ts:43 (4 sites sans garde) | Devise hors table de repli + Frankfurter en échec → 500 sur tout le portefeuille | audit-fx |
| IMP-03 | P2 | import/commit.ts:558 | Transaction passée (2021) importée avec fxRateToEur forcé à "1" → taux DU JOUR appliqué (~10% de dérive) | audit-import |
| API-W-03 | P2 | wallets/zerion/sync/route.ts:144 | Clé API invalide écrite en base AVANT validation → écrase la clé valide précédente | audit-api-write |
| API-W-02 | P2 | wallets/solana/sync/route.ts:113 | Adresse invalide écrite en base AVANT validation → écrase l'adresse valide précédente | audit-api-write |
| API-W-04 | P2 | wallets/{zerion,monero,solana}/sync | 200 {ok:true, ledgerWritten:false} — sync silencieusement inopérante, statut vert | audit-api-write |
| API-W-05 | P2 | import/commit/route.ts:42 | Aucun zod sur accountType/assetClass → contourne l'énumération validée de POST /api/assets | audit-api-write |
| FX-02 | P2 | market/providers/yahoo.ts:61 | Cotation en pence (GBX) lue comme livres → prix ×100 sur les actions LSE | audit-fx |
| FX-03 | P2 | market/fx.ts:96 | Taux de repli (table statique) enregistré/affiché comme un taux réel constaté, sans distinction | audit-fx |
| IMP-05 | P2 | import/commit/route.ts:33 | Lot de 300 lignes DIVIDENDE : lambda tuée mi-lot, écritures partielles sans rapport {line,message} | audit-import |
| SHELL-01 | P2 | dashboard/kpi-strip.tsx:152 | Résidu du retrait de history[] : tuile "P&L latent (période)" affiche le cumul total sous un mauvais libellé | audit-shell |
| API-C-03 | P2 | vercel.json:5 | savings/accrue documenté "cron" mais absent de vercel.json et n'expose que POST (Vercel appelle en GET) | audit-api-cron |

## Section 3 — Inventaire API (constats par route)

| Chemin | Type | Agent | Constats |
|---|---|---|---|
| /api/crypto/defi/positions/[id]/events | write | audit-api-write | API-W-01, API-W-09 |
| /api/wallets/solana/sync | write | audit-api-write | API-W-02 |
| /api/wallets/zerion/sync | write | audit-api-write | API-W-03, API-W-04 |
| /api/wallets/monero/sync | write | audit-api-write | API-W-04 |
| /api/import/commit | write | audit-api-write, audit-import | API-W-05, IMP-03, IMP-07, IMP-10, IMP-11, IMP-15 |
| /api/crypto/defi/strategies/[id] | write | audit-api-write | API-W-06 |
| /api/securities/accounts/[id] | write | audit-api-write | API-W-06 |
| /api/securities/contributions/[id] | write | audit-api-write | API-W-06 |
| /api/precious-metals, /api/crowdlending, /api/private-equity, /api/tangibles | write | audit-api-write | API-W-07 |
| /api/crypto/nft/[assetId], /positions/[assetId]/flags | write | audit-api-write | API-W-08 |
| /api/crypto/defi/positions | write | audit-api-write | API-W-10 |
| /api/savings | write | audit-api-write | API-W-11 |
| /api/cron/collect-intraday | cron | audit-api-cron | API-C-01, API-C-02 |
| /api/savings/accrue | write (cron de fait) | audit-api-cron | API-C-03 |
| — (app/lib/market/fx.ts, transversal) | — | audit-fx | FX-01 à FX-10 |
| — (app/lib/import/**, transversal) | — | audit-import | IMP-01, IMP-02, IMP-04 à IMP-06, IMP-08, IMP-09, IMP-12 à IMP-14 |
| — (components shell, transversal) | — | audit-shell | SHELL-01 à SHELL-12 |
| — (prisma/seed-portfolio.ts) | — | audit-seed | SEED-01 |
| — (components/layout/notification-bell.tsx) | — | audit-notif | NOTIF-01 à NOTIF-04 |

**Routes sans constat (échantillon large, non exhaustif)** : les 32 routes read intégralement lues, les routes IDOR-sensibles à paramètre `[id]` (assets, banks, crypto/nft, real-estate/properties, savings, securities, tangibles, term-deposits, trading/accounts), platforms, liabilities, employee-savings, crypto/futures, trading, auth/change-password.

**Total routes :** 108 · **Constats liés à une route précise :** ~24 routes sur 108 · **Couverture d'audit :** 100% catégorisées, profondeur variable (cf. notes de couverture dans api-write.md).

## Section 4 — Domaines : détail

### 4.1 Surfaces oubliées

**FX** (10, 0 P0/P1, 5 P2, 5 P3) — aucun P0/P1 mais 5 P2 réels : cotation GBX×100 (FX-02), taux de repli non signalé (FX-03), refus fournisseur confondu avec absence de taux (FX-04), devise hors table + panne réseau = 500 global (FX-05), split prix/change qui mélange les devises dans l'affichage (FX-01). Le 5e P2 attendu (FX-05) est le plus sérieux : même motif qu'ES-02 (audit 1) sur un périmètre différent (holdings, pas épargne salariale).

**Import** (15, 0 P0/P1, 5 P2, 10 P3) — le point le plus sérieux : IMP-04, une VENTE peut être journalisée sans son ACHAT si l'insert Prisma échoue après une mise à jour d'état en mémoire, sans transaction englobante. IMP-01/02 sont des dédoublonnages/parsings incorrects qui font disparaître des lignes valides. IMP-03 applique un taux FX actuel à une transaction historique (import CSV, distinct de JOU-02 qui portait sur la saisie manuelle).

**Shell** (12, 0 P0/P1, 6 P2, 6 P3) — SHELL-10 (fuite cross-user via localStorage non namespacé) est le constat le plus sensible du lot entier bien que classé P2 (pas d'accès serveur, mais fuite réelle de données personnelles entre utilisateurs d'un même navigateur partagé). SHELL-01 à 04 sont des résidus directs du retrait de `history[]` (audit 1) sur des composants non couverts à l'époque : préférence KPI muette, devise de reporting non restaurée, états d'erreur réseau rendus comme "vide" plutôt qu'"inconnu" (violation UNKNOWN≠0 côté shell).

**CI** (0 constat) — périmètre déjà largement couvert par audit 1 (API-01 à 04) ; rien de nouveau trouvé sur .github/** ni le reste de e2e/**.

### 4.2 API — Mutations

**Write** (11, 1 P1, 4 P2, 6 P3) — API-W-01 (P1) : un DeFi reward accru peut être décrémenté indéfiniment par des tentatives échouées, sans jamais être journalisé — la seule vraie perte de données silencieuse trouvée dans ce lot. 3 routes de sync wallet (Solana, Zerion) écrivent la donnée AVANT de la valider (API-W-02/03) — inversion de l'ordre écriture/validation, un motif répété. API-W-04 généralise à 3 routes un défaut déjà corrigé ailleurs (200 sur échec).

**Cron** (3, 0 P0/P1, 2 P2, 1 P3) — le risque OOM/staleness de `collect-intraday` est déjà entièrement couvert par l'audit 1 (MAR-01 à 08, PER-01), non re-signalé ici. Le nouvel angle (authentification) est sain : le secret est vérifié en temps constant et la route se ferme proprement en son absence — mais silencieusement (API-C-01), et un second endpoint cron de fait (`savings/accrue`) n'est pas déclaré dans `vercel.json` (API-C-03).

### 4.3 API — Accès

**Read** (0 constat) — 32/32 routes lues intégralement, aucune faille d'autorisation ni de payload trouvée.

**Authz / IDOR** (0 constat) — cross-audit sur les 108 routes, aucune faille IDOR. C'est la confirmation la plus importante de ce lot : la doctrine "id d'autrui = P0 garanti" n'a mordu sur aucune route.

### 4.4 Infrastructure

**Seed** (1, 1 P1, 0 P2, 0 P3) — SEED-01 : 28,7% des clôtures récentes générées par le seed tombent un jour où le marché est fermé (week-end), mesuré sur 25 036 lignes simulées. Défaut de DONNÉE (P1, pas P0) — le moteur de valorisation lui-même n'est pas en cause ici.

**Notif** (4, 0 P0/P1, 1 P2, 3 P3) — la doctrine du workflow supposait la feature absente ; elle existe (cloche in-app). 1 P2 réel : le statut lu/non-lu d'une notification n'est porté que par une couleur, jamais annoncé à un lecteur d'écran.

**Env** (0 constat) — les 5 secrets critiques vérifiés (CRON_SECRET, AUTH_SECRET, FINNHUB_API_KEY, Upstash, DATABASE_URL) ont tous une garde explicite et un comportement de repli documenté et sain en leur absence.

## Section 5 — Déduplication vs Audit 1

### Constats liés (même domaine, angle différent — pas des doublons)
- **FX-05** (holdings illisibles si devise hors table + panne réseau) est LIÉ à **ES-02** (audit 1, même motif sur l'épargne salariale) — périmètres distincts, les deux comptent.
- **API-W-06** (DELETE "succès" sur ressource introuvable, 3 nouvelles routes) est LIÉ au motif déjà corrigé sur banks/savings/term-deposits (D39/D40) — extension du même défaut à un nouveau périmètre, pas une régression.
- **SHELL-06** (suppression admin bloquée par RESTRICT sur Platform via Asset/SecuritiesAccount) partage sa racine avec **AUTH-01/PLA-01/PRI-01** (audit 1, wipe bloqué par le même RESTRICT) — surface différente (suppression admin vs wipe self-service), les deux comptent séparément.
- **IMP-03** (taux FX du jour appliqué à un import CSV historique) est LIÉ à **JOU-02** (audit 1, même défaut sur la saisie manuelle transactions/service.ts) — chemin d'entrée différent (import vs saisie), même cause racine (`resolveFx` traite `fxRateToEur:"1"` comme "non fourni").
- **SHELL-01 à 04** sont des conséquences directes, non couvertes par audit 1, du retrait de `history[]` déjà documenté comme fermé — ce ne sont pas des réouvertures de ce point mais des résidus dans des composants que l'audit 1 n'avait pas balayés (kpi-strip, préférences, états d'erreur du shell).

### Conflits
Aucun [CONFLIT] entre agents relevé sur ce lot.

### Fermés Audit 1 (confirmés, non réouverts)
- **parseNumber partagé** : toujours la source unique correcte — mais audit 2 trouve 9 NOUVEAUX sites de parsing ad hoc qui la CONTOURNENT dans l'import (IMP-02, IMP-12), non listés par l'audit 1 (qui portait sur d'autres modules). Le principe reste nominal ; ce sont de nouveaux appelants fautifs, pas une régression de la fonction elle-même.
- **collect OOM 6500 jours** : toujours présent, toujours intentionnel — confirmé par audit-api-cron, non re-signalé.
- **history[] hors /api/portfolio** : confirmé qu'aucune route hors périmètre ne le réintroduit — mais des résidus consommateurs de l'ancien contrat subsistent côté shell (SHELL-01), nouveau constat, pas une réouverture.
- **DELETE inventaire plateformes** : le principe (D39/D40, DELETE sur ressource introuvable = pas un "succès" silencieux) n'a jamais été étendu aux routes crypto/defi/strategies, securities/accounts, securities/contributions — API-W-06 documente cette extension manquante, nouveau périmètre.
- **mode=short + sessionGap, cap 6 ans, to daily-nav** : hors périmètre de cette vague, non retouchés, rien à confirmer ici.

## Section 6 — Lots de reprise

### Lot 1 : Écritures qui mentent (avant validation, sans rollback)
**Constats :** API-W-01, API-W-02, API-W-03, API-W-08, API-W-09, IMP-04, IMP-11
**Impact :** Critique — perte de données silencieuse (rewards DeFi décrémentés à chaque échec, VENTE sans ACHAT) ou état incohérent persistant (clé/adresse invalide écrasant une valide)
**Effort :** 3-4 jours
**Blocage :** Oui (API-W-01 dégrade la donnée à chaque tentative de l'utilisateur, sans limite)

#### Descriptif
1. API-W-01 : décrémenter l'accru DeFi APRÈS la validation de la date, jamais avant
2. API-W-02/API-W-03 : valider adresse/clé AVANT toute écriture Prisma
3. API-W-08/API-W-09 : rendre les 2 services (hide + floor price ; event + lien ledger) atomiques ou séquencer la validation avant tout commit
4. IMP-04 : entourer le lot d'import d'une transaction Prisma englobante, ou valider l'insert avant de mettre à jour l'état ledger en mémoire
5. IMP-11 : rollback de l'Asset créé si la Transaction associée échoue

#### Ordre
- API-W (validation avant écriture, 5 routes) : 2j
- IMP-04/11 (atomicité import) : 1-2j

---

### Lot 2 : Devise et données financières douteuses
**Constats :** FX-02, FX-03, FX-05, IMP-02, IMP-03, SEED-01
**Impact :** Élevé — prix ×100 sur cotations LSE, portefeuille illisible sur panne réseau, taux FX erroné de ~10% sur import historique, 28,7% de clôtures démo un jour de marché fermé
**Effort :** 3-4 jours
**Blocage :** Non

#### Descriptif
1. FX-02 : normaliser GBX/GBp avant conversion (comme le fait déjà l'import CSV)
2. FX-05 : garde FxRateUnknownError sur les 4 sites holdings identifiés, comme providers/manual.ts le fait déjà
3. FX-03 : exposer isFallback dans la réponse API et l'affichage
4. IMP-02 : router les 4 sites ibkr-activity.ts vers parseNumber partagé
5. IMP-03 : router le taux historique (comme DIVIDENDE/COUPON) au lieu de fxRateToEur:"1" forcé sur tout import
6. SEED-01 : ajouter isWeekend/previousBusinessDay à la boucle de génération récente (déjà utilisés 40 lignes plus bas dans le même fichier)

#### Ordre
- FX (garde + normalisation) : 2j
- Import (parseNumber + taux historique) : 1j
- Seed (garde jour ouvré) : 0,5j

---

### Lot 3 : Résilience du shell & confort
**Constats :** SHELL-01, SHELL-03, SHELL-04, SHELL-10, API-C-01, API-C-03, API-W-04, API-W-05, API-W-06, API-W-07, IMP-05, NOTIF-01
**Impact :** Moyen — pas de perte de données financières, mais confusion utilisateur (états d'erreur rendus comme vides), une fuite de données personnelles entre utilisateurs (SHELL-10), et un cron non déclenché automatiquement (API-C-03)
**Effort :** 3-4 jours
**Blocage :** Non, sauf SHELL-10 à traiter en priorité dans ce lot (nature different d'un simple confort)

#### Descriptif
1. SHELL-10 : préfixer les clés localStorage par userId, purger au sign-out
2. SHELL-03/04 : distinguer isError de "vide" dans portfolio-app.tsx
3. SHELL-01 : retirer la préférence "P&L latent — période" ou réimplémenter la source
4. API-C-03 : ajouter savings/accrue à vercel.json (en GET) ou documenter son déclenchement réel
5. API-C-01 : promouvoir cronSecretConfigured:false en avertissement visible
6. API-W-04/06/07 : harmoniser les statuts (200 sur échec, "succès" sur introuvable, 500 générique sur erreur métier)
7. IMP-05 : checkpoint intermédiaire sur les lots d'import volumineux
8. NOTIF-01 : annoncer le statut lu/non-lu au lecteur d'écran (aria-label ou texte visible)

#### Ordre
- SHELL-10 (sécurité des données personnelles) : 1j
- Shell résilience réseau (SHELL-01/03/04) : 1j
- Cron/API harmonisation : 1-1,5j
- Notif a11y : 0,5j

## Section 7 — État / Historique

### parseNumber partagé
Audit 1 : fonction centralisée, source unique correcte.
Audit 2 : toujours la seule implémentation correcte — mais 9 nouveaux sites dans l'import (IBKR/Hyperliquid/Paradex) la contournent avec des `Number(x.replace(...))` ad hoc, non identifiés par l'audit 1.
→ Le principe reste nominal ; IMP-02/IMP-12 documentent une extension non faite, pas une régression.

### collect OOM 6500 jours
Audit 1 : limitation intentionnelle documentée (cap 6 ans, MAR-01/02).
Audit 2 (audit-api-cron) : toujours présent, toujours borné dans le code actuel.
→ Nominal, pas P0.

### history[] hors /api/portfolio
Audit 1 : retrait localisé et intentionnel (25a8265).
Audit 2 : confirmé qu'aucune AUTRE route ne le réintroduit — mais SHELL-01 documente un composant shell qui suppose encore sa présence (résidu, pas une réouverture de la décision).
→ Nominal côté API ; nouveau constat côté consommateur shell.

### DELETE inventaire plateformes
Audit 1 : le principe "DELETE sur ressource introuvable ≠ succès silencieux" est déjà corrigé sur banks/savings/term-deposits (D39/D40).
Audit 2 : API-W-06 montre que ce principe n'a jamais été étendu à 3 routes crypto/securities.
→ Le principe reste valide ; extension manquante documentée comme nouveau périmètre, pas un défaut du principe.

### Notifications (correction de doctrine)
La doctrine de ce workflow supposait la feature absente. Audit 2 (audit-notif) a vérifié par preuve glob que la cloche in-app existe réellement (`app/lib/notifications/**`) ; seuls email et webhook sont absents.
→ Doctrine corrigée pour toute suite d'audit : "Notifications" = cloche in-app existante + email/webhook absents, pas une feature N/A globale.

## Phase 6 — Clôture

Rapport compilé en lecture seule. Aucune correction de code effectuée pendant cet audit (11/11 agents en lecture seule, 0 écriture détectée). Commit unique à suivre : le rapport + `audit/raw/` (11 nouveaux fichiers + l'inventaire API, trace complète par agent).

**Prochaine étape** : créer des prompts de fix distincts par lot (section 6), un par lot. Ne pas relancer un audit exhaustif avant correction du Lot 1 (écritures qui mentent).
