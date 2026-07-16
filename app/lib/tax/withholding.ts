/**
 * Prélèvement à la source (withholding tax) sur dividendes / coupons.
 *
 * - WHT pays d'origine : toujours applicable (sauf FR sur émetteur FR typiquement 0 en modèle simplifié).
 * - PFU / IR français (CTO ~30 %) : NON appliqué dans le cashflow de performance (reporting fiscal séparé).
 * - PEA / AV : pas de PFU à l'encaissement ; WHT étranger reste.
 */

export type AccountEnvelope = "CTO" | "PEA" | "AV" | "CRYPTO" | "IMMOBILIER" | "CFD" | string;

/** Taux conventionnels simplifiés (0–1). À affiner selon conventions fiscales. */
export const DEFAULT_WHT_BY_COUNTRY: Record<string, number> = {
  US: 0.15,
  DE: 0.26375,
  FR: 0,
  GB: 0,
  UK: 0,
  CH: 0.35,
  NL: 0.15,
  BE: 0.3,
  ES: 0.19,
  IT: 0.26,
  IE: 0.25,
  LU: 0.15,
  CA: 0.15,
  JP: 0.15315,
  AU: 0.15,
  SE: 0.3,
  NO: 0.25,
  DK: 0.27,
  FI: 0.3,
  PT: 0.25,
  AT: 0.275,
};

export type WhtContext = {
  countryCode: string | null;
  /** Taux source 0–1 */
  whtRate: number;
  accountType: AccountEnvelope;
  /** Toujours false en MVP perf — PFU hors cashflow */
  applyFrenchPfuInCashflow: false;
};

export function normalizeCountryCode(raw?: string | null): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  if (c.length === 2) return c;
  // quelques alias
  const map: Record<string, string> = {
    USA: "US",
    UNITED_STATES: "US",
    UK: "GB",
    GBR: "GB",
    DEU: "DE",
    GERMANY: "DE",
    FRA: "FR",
    FRANCE: "FR",
  };
  return map[c] ?? (c.length >= 2 ? c.slice(0, 2) : null);
}

export function defaultWhtRateForCountry(countryCode?: string | null): number {
  const c = normalizeCountryCode(countryCode);
  if (!c) return 0;
  return DEFAULT_WHT_BY_COUNTRY[c] ?? 0;
}

/**
 * Résout le taux WHT effectif.
 * Priorité : override transaction > override asset > table pays.
 */
export function resolveWhtRate(opts: {
  countryCode?: string | null;
  assetWithholdingTaxRate?: number | string | null;
  txWithholdingTaxRate?: number | string | null;
}): number {
  const tx = num01(opts.txWithholdingTaxRate);
  if (tx != null) return tx;
  const asset = num01(opts.assetWithholdingTaxRate);
  if (asset != null) return asset;
  return defaultWhtRateForCountry(opts.countryCode);
}

function num01(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1 && n <= 100) return n / 100; // allow 15 for 15%
  if (n > 1) return 1;
  return n;
}

export function buildWhtContext(opts: {
  countryCode?: string | null;
  accountType?: AccountEnvelope | null;
  assetWithholdingTaxRate?: number | string | null;
  txWithholdingTaxRate?: number | string | null;
}): WhtContext {
  const countryCode = normalizeCountryCode(opts.countryCode);
  return {
    countryCode,
    whtRate: resolveWhtRate(opts),
    accountType: opts.accountType || "CTO",
    applyFrenchPfuInCashflow: false,
  };
}

/**
 * Calcule brut / WHT / net en EUR à partir d'un montant brut en EUR
 * (cashAmount déjà converti) et des frais EUR.
 *
 * netCash = grossEur - withholdingEur - feesEur
 */
export function splitDividendEur(opts: {
  grossEur: number;
  feesEur?: number;
  whtRate: number;
}): {
  grossEur: number;
  withholdingEur: number;
  feesEur: number;
  netEur: number;
  whtRate: number;
} {
  const grossEur = Math.max(0, opts.grossEur);
  const feesEur = Math.max(0, opts.feesEur ?? 0);
  const whtRate = Math.min(1, Math.max(0, opts.whtRate));
  const withholdingEur = grossEur * whtRate;
  const netEur = Math.max(0, grossEur - withholdingEur - feesEur);
  return { grossEur, withholdingEur, feesEur, netEur, whtRate };
}

/** Net = Brut × (1 − taux) − frais (devise native, avant FX). */
export function netFromGrossNative(
  grossNative: number,
  whtRate: number,
  feesNative = 0
): number {
  const r = Math.min(1, Math.max(0, whtRate));
  return Math.max(0, grossNative * (1 - r) - Math.max(0, feesNative));
}
