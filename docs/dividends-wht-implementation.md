# Dividendes & prélèvement à la source (P0–P1)

## Modèle

### Asset
- `countryCode` (ISO2) — pays émetteur
- `withholdingTaxRate` — override optionnel (0–1)

### Transaction (revenus)
- `withholdingTaxEur` / `withholdingTaxRate` — snapshot à la création
- `exDate` / `paymentDate` — calendrier (cash reconnu à `paymentDate` ou `occurredAt`)
- `grossAmountEur` = brut  
- `netCashImpactEur` = brut − WHT − frais  
- `feesEur` = frais courtier (pas le WHT)

### Performance (`total-return.ts`)
- `dividendsGrossCumEur` / `dividendsNetCumEur` / `withholdingCumEur`
- `totalPnlEur` utilise les **div nets**
- `incomePnlEur` = flux nets du jour (payment date)

### UI
Mode graphe **Dividendes** : courbe amber des nets cumulés + tooltip brut/WHT.

## Formule
`net = gross × (1 − whtRate) − fees` (EUR via `fxRateToEur` du jour de paiement).

PEA/CTO : WHT source toujours ; PFU FR **hors** cashflow de perf (MVP).

## Migration
`prisma/migrations/20260716140000_dividend_withholding/migration.sql`

```bash
npx prisma migrate deploy
npx prisma generate
```

---

## P2 — Accrual, formulaires, FX historique

### Accrual ex-date → payment
Si `exDate < paymentDate` :
1. **Ex-date** : `dividendReceivableEur += net` (compense la baisse de cours dans `totalPnlEur`)
2. **Payment** : `receivable -= net`, `dividendsNetCumEur += net`

`totalPnlEur = positionValue + divCash + receivable + realized − cashInvested`

### Formulaires
- **Transaction** (DIVIDENDE/COUPON/…) : ex-date, payment date, taux WHT ; FX historique auto via `/api/fx?from=USD&date=YYYY-MM-DD`
- **Fiche actif** : pays ISO + override WHT (PATCH `/api/assets/:id`)

### FX
`fxRateToEurOnDate` (Frankfurter historique) appliqué aux revenus si taux = 1 ou absent.
