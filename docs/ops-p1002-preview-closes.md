# P1002 — preview bloquée par des clôtures introuvables

Vague2 D4 aligne hero, sparks KPI et watchlist sur le **dernier jour** de
`getDailyNav`. Le DoD exige un écart ≤ 1 séance entre `watchlist.closeDay`
et ce dernier point, pour un même ticker.

Ce n'est pas un défaut d'UI si l'écart vient d'un cache `AssetDailyClose`
qui n'a pas été collecté : quota fournisseur, 429, preview sans
`CRON_SECRET`, Yahoo/CoinGecko muet. Dans ce dépôt cet incident est
**P1002**.

## Ce qu'il ne faut pas faire

- Ne pas compenser côté écran (badge inventé, date forcée, interpolation).
- Ne pas redessiner le cron des clôtures quotidiennes (hors périmètre D4).
- Ne pas toucher à la page Portefeuille ni au donut.

## Ticket ops (séparé)

1. Vérifier `GET /api/cron/collect-intraday` sur la preview (secret,
   `maxDuration`, rapport `assetsFilled` / `errors`).
2. Lire les incidents fournisseur (`provider-incidents` : 429, timeout).
3. Relancer un backfill **hors** chemin de lecture (cron ou POST authentifié).
4. Contrôler `AssetDailyClose.fetchedAt` : s'il a plus de 24 h, le front
   peut afficher le badge « cours daté » (D11, `fetchedAt` déjà exposé).

Tant que P1002 n'est pas levé, la preview peut montrer un écart de dates
supérieur à une séance. C'est un trou de collecte, pas une divergence de
formule.
