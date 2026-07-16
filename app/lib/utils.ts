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
