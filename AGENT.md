# Patrimo — Environnement de test (agent)

Ce fichier documente l’accès à l’instance de test déployée sur Vercel pour les agents (Grok, Cursor, Playwright, etc.).

## URL de test

- **Production (test agent)** : https://patrimo-psi.vercel.app
- **Health check** : `GET /api/health`
- **Dépôt GitHub** : https://github.com/pakkof13-a11y/Patrimo (privé, branche `staging`)

## Authentification

| Champ | Valeur |
|-------|--------|
| Identifiant | `demo` (ou `demo@patrimo.fr`) |
| Mot de passe | `demo1234` |
| Admin (optionnel) | `admin` / voir seed Vercel |

Page de connexion : `/login`

## Scénarios utiles pour un agent

1. **Connexion** — `/login` → identifiants ci-dessus → redirection `/positions`
2. **API holdings** — `GET /api/holdings` (session requise)
3. **API portfolio** — `GET /api/portfolio`
4. **Navigation** — onglets Dashboard, Positions, Transactions, Plateformes
5. **E2E de référence** — voir `e2e/` (dashboard, navigation, import-csv, purchase-sale)

## Notes

- Base réinitialisée à chaque déploiement (`db:seed`).
- Données fictives uniquement — ne pas y stocker de données réelles.
- `ALLOW_DEMO_FALLBACK=true` sur cet environnement.