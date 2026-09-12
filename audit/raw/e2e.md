# audit-e2e — Specs mortes, testids

Aucun constat.

Périmètre exclu (déjà couvert par audit-api, non dupliqué ici) : e2e/api-health.spec.ts, e2e/evolution-account.spec.ts, e2e/evolution-envelope.spec.ts (API-01 à API-04, retrait de `history[]`).

Vérification systématique des data-testid référencés par les specs vs présents dans le DOM/composants : tous confirmés présents. Aucune spec morte ni testid orphelin trouvé ailleurs dans e2e/**.
