import { d, type DecimalInput } from "./decimal";
import { getCurrency } from "./currencies";

export function formatMoney(value: DecimalInput, currency = "EUR"): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(d(value).toNumber());
  } catch {
    return `${d(value).toFixed(2)} ${code}`;
  }
}

export function formatEur(value: DecimalInput): string {
  return formatMoney(value, "EUR");
}

export function formatPct(ratio: DecimalInput): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d(ratio).toNumber());
}

export function formatPctPoints(points: DecimalInput): string {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d(points).toNumber())} %`;
}

export function formatQty(value: DecimalInput): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(d(value).toNumber());
}

export function formatDateParis(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTimeParis(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function currencyBadge(code: string): string {
  const c = getCurrency(code);
  return `${c.code} (${c.symbol})`;
}

