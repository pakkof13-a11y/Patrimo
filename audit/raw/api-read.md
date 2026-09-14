# audit-api-read — routes read (32)

Aucun constat.

Les 32 routes GET-only de audit/raw/api-inventory.md ont été lues intégralement (401/403, payload, défaut de plage temporelle, scope vide, autocomplete). Aucune faille d'autorisation, aucune fuite de payload, aucun défaut de plage/scope trouvé. Les 2 occurrences de `maxDuration` rencontrées pendant la recherche appartiennent à des routes write (valuations/refresh, nft/sync), hors périmètre de cet agent, toutes deux sous le plafond de 300s.
