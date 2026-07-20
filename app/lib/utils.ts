import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ASSET_CLASSES, type AssetClass } from "./constants";
import { formatMoney, formatPctPoints, formatDateParis } from "./money/format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency: string = "EUR") {
  return formatMoney(value, currency);
}

/**
 * Montants monétaires adaptatifs :
 * - ≥ 0,01 → 2 décimales classiques
 * - micro (ex. dust crypto) → assez de décimales pour ne jamais afficher 0,00 € à tort
 */
export function formatCurrencyPrecise(
  value: number | string,
  currency: string = "EUR"
) {
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return formatMoney(value, currency);
  const abs = Math.abs(n);
  if (abs === 0) return formatMoney(0, currency);
  if (abs >= 0.01) return formatMoney(n, currency);
  // Micro-montant : conserver les chiffres significatifs (jusqu’à 12)
  const maxFrac = abs < 1e-8 ? 12 : abs < 1e-4 ? 10 : 8;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: maxFrac,
    }).format(n);
  } catch {
    return `${n.toFixed(maxFrac)} ${currency}`;
  }
}

/**
 * Notation lisible pour prix unitaires très petits.
 * Ancienne forme « 0,e5251 » abandonnée (illisible) :
 * - 0,00000251 → « 0,00000251 » si ≤ 10 zéros après la virgule avant le 1er chiffre
 * - sinon notation scientifique FR : « 2,51×10⁻¹² »
 */
export function formatMicroCompact(value: number | string): string | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  const abs = Math.abs(n);
  // Uniquement si < 0,01 (micro / dust)
  if (abs >= 0.01) return null;

  // Expansion décimale stable (évite 2.51e-6 flottant)
  let fixed = abs.toFixed(18).replace(/0+$/, "");
  if (!fixed.includes(".")) fixed += ".";
  const m = fixed.match(/^0\.(0*)([1-9]\d*)$/);
  if (!m) return null;
  const zeros = m[1]!.length;
  if (zeros < 2) return null; // 0,01… reste en notation classique
  const rest = m[2]!;
  const sign = n < 0 ? "-" : "";

  // Jusqu’à 10 zéros : décimales complètes (tronquées à 8 chiffres utiles)
  if (zeros <= 10) {
    const digits = rest.slice(0, 8);
    return `${sign}0,${"0".repeat(zeros)}${digits}`;
  }

  // Très micro : 2,51×10⁻¹²
  const exp = -(zeros + 1);
  const mantissaRaw = `0.${rest}`.slice(0, 6);
  const mant = Number(mantissaRaw);
  if (!Number.isFinite(mant) || mant === 0) return null;
  const mantStr = mant
    .toFixed(4)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
  const expAbs = Math.abs(exp);
  const expSup = String(expAbs)
    .split("")
    .map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)] ?? d)
    .join("");
  const expSign = exp < 0 ? "⁻" : "⁺";
  return `${sign}${mantStr}×10${expSign}${expSup}`;
}

/** Quantités (crypto / fractions d’actions) — conserve toutes les décimales utiles. */
export function formatQuantity(value: number | string) {
  if (value == null || value === "") return "—";
  // Préserver la précision string (évite 2.51e-6 → pertes)
  const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const neg = raw.startsWith("-");
    const body = neg ? raw.slice(1) : raw;
    const [intPart, frac = ""] = body.split(".");
    const fracTrim = frac.replace(/0+$/, "");
    const sign = neg ? "-" : "";
    if (!fracTrim) {
      return new Intl.NumberFormat("fr-FR").format(Number(sign + intPart));
    }
    // FR : virgule décimale, pas de regroupement sur la partie fractionnaire
    const intFmt = new Intl.NumberFormat("fr-FR").format(Number(intPart));
    return `${neg ? "-" : ""}${intFmt},${fracTrim}`;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(value ?? "—");
  const abs = Math.abs(n);
  const maxFrac = abs > 0 && abs < 0.01 ? 12 : abs < 1 ? 10 : 8;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

/** Prix unitaires — micro-crypto lisible + précision élevée. */
export function formatUnitPrice(
  value: number | string,
  currency: string = "EUR",
  opts?: { crypto?: boolean }
) {
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return formatMoney(value, currency);

  const compact = formatMicroCompact(n);
  if (compact) {
    const sym =
      currency.toUpperCase() === "EUR"
        ? "€"
        : currency.toUpperCase() === "USD"
          ? "$"
          : currency.toUpperCase();
    // « 0,00000251 € » ou « 2,51×10⁻¹² € »
    return `${compact}\u00a0${sym}`;
  }

  const abs = Math.abs(n);
  const maxFrac = opts?.crypto
    ? abs < 1
      ? abs < 0.01
        ? 10
        : 8
      : 6
    : abs < 1
      ? 6
      : 4;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: abs < 1 ? 2 : 2,
      maximumFractionDigits: maxFrac,
    }).format(n);
  } catch {
    return `${n.toFixed(maxFrac)} ${currency}`;
  }
}

export function formatPercent(value: number | string) {
  return formatPctPoints(value);
}

export function formatDate(value: string | Date) {
  return formatDateParis(value);
}

export function getAssetClassLabel(key: string) {
  return ASSET_CLASSES[key as AssetClass] ?? key;
}

export function getChangeColor(value: number | string) {
  const n = Number(value);
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "text-slate-500 dark:text-slate-400";
}
