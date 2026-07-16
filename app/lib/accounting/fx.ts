import { d, type Decimal, type DecimalInput } from "../money/decimal";
// FX conversion helpers

/**
 * Convert an amount in original currency to EUR.
 * fxRateToEur is the multiplier: amountEur = amount * fxRateToEur
 * Example: 100 USD with rate 0.92 → 92 EUR
 */
export function toEur(amount: DecimalInput, fxRateToEur: DecimalInput): Decimal {
  return d(amount).times(d(fxRateToEur));
}

export function fromEur(amountEur: DecimalInput, fxRateToEur: DecimalInput): Decimal {
  const rate = d(fxRateToEur);
  if (rate.isZero()) {
    throw new Error("Taux de change invalide (0)");
  }
  return d(amountEur).div(rate);
}

export function normalizeFxRate(fxRateToEur: DecimalInput | null | undefined): Decimal {
  if (fxRateToEur === null || fxRateToEur === undefined || fxRateToEur === "") {
    return d(1);
  }
  const rate = d(fxRateToEur);
  if (rate.lte(0)) {
    throw new Error("Le taux de change doit être strictement positif");
  }
  return rate;
}
