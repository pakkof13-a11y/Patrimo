# Patrimo — Environnement de test (agent)

Ce fichier documente l’accès à l’instance de test pour les agents (Grok, Cursor, Playwright, etc.).

## URL de test

- **Production (test agent)** : https://patrimo-psi.vercel.app
- **Health check** : `GET /api/health`
- **Dépôt GitHub** : https://github.com/pakkof13-a11y/Patrimo (privé, branche `staging`)

## Authentification

Les **mots de passe ne sont pas documentés ici** (hygiène secrets).

| Champ | Source |
|-------|--------|
| Identifiant démo | `demo` (ou `DEMO_USERNAME` / `DEMO_EMAIL`) |
| Mot de passe démo | variable d’environnement `DEMO_PASSWORD` ou `E2E_PASS` |
| Admin | `ADMIN_USERNAME` + `ADMIN_PASSWORD` (seed / ops) |

Page de connexion : `/login`

Configurer le local via `.env` (modèle : `.env.example`). Voir **`docs/secrets.md`** pour la rotation et la checklist déploiement.

## Scénarios utiles pour un agent

1. **Connexion** — `/login` → identifiants depuis l’env de l’environnement cible → redirection `/positions`
2. **API holdings** — `GET /api/holdings` (session requise)
3. **API portfolio** — `GET /api/portfolio`
4. **Navigation** — onglets Dashboard, Positions, Transactions, Plateformes
5. **E2E de référence** — voir `e2e/` (dashboard, navigation, import-csv, purchase-sale)

## Notes

- Base réinitialisée à chaque déploiement de test (`db:seed`) si configuré ainsi.
- Données fictives uniquement — ne pas y stocker de données réelles.
- `ALLOW_DEMO_FALLBACK` uniquement sur environnements de démo / e2e, pas en prod réelle.
