/**
 * Export CSV d'une sélection de positions — fonction pure (pas de DOM).
 *
 * Délimiteur `;` et décimales à virgule : convention Excel FR, qui lit un
 * CSV `,`-décimal comme un flux de nombres mal séparés dès que le champ
 * contient déjà une virgule décimale.
 */

import type { Holding } from "@/app/lib/types/ui";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import {
  formatCurrency,
  formatPercent,
  formatUnitPrice,
  getAssetClassLabel,
} from "@/app/lib/utils";
import { HOLDINGS_COLUMN_META } from "@/app/lib/display-preferences";

const CSV_DELIMITER = ";";

function csvField(value: string): string {
  const needsQuoting = /["\n\r;]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

type ColumnValueFn = (h: Holding, baseCurrency: string) => string;

const COLUMN_VALUES: Record<string, ColumnValueFn> = {
  name: (h) => h.name,
  ticker: (h) => h.ticker || "",
  accountType: (h) =>
    ACCOUNT_TYPES[(h.accountType || "CTO") as AccountType] ||
    h.accountType ||
    "",
  platformName: (h) => h.platformName || "",
  blockchain: (h) => h.blockchainLabel || h.blockchainKey || "",
  currency: (h) => h.currency || "",
  assetClass: (h) => getAssetClassLabel(h.assetClass),
  quantity: (h) =>
    Number(h.quantity).toLocaleString("fr-FR", { maximumFractionDigits: 8 }),
  avgCostEur: (h) => formatCurrency(h.avgCostEur, "EUR"),
  currentPriceNative: (h) =>
    formatUnitPrice(h.currentPriceNative, h.currency, {
      crypto: h.assetClass === "CRYPTO",
    }),
  marketValueBase: (h, base) =>
    formatCurrency(h.marketValueBase || h.marketValueEur, base),
  unrealizedPnlBase: (h, base) =>
    formatCurrency(h.unrealizedPnlBase || h.unrealizedPnlEur, base),
  unrealizedPnlPct: (h) => formatPercent(h.unrealizedPnlPct),
  allocationPctOfClass: (h) =>
    `${Number(h.allocationPctOfClass || 0).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} %`,
  allocationPct: (h) =>
    `${Number(h.allocationPct || 0).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} %`,
  acquisitionFeesBase: (h, base) =>
    formatCurrency(h.acquisitionFeesBase || h.acquisitionFeesEur || "0", base),
  lastUpdatedAt: (h) => h.lastUpdatedAt || "",
  passiveIncomeBase: (h, base) =>
    formatCurrency(h.passiveIncomeBase || h.passiveIncomeEur || "0", base),
  breakEvenBase: (h, base) =>
    formatCurrency(
      h.breakEvenBase || h.breakEvenEur || h.avgCostEur,
      base
    ),
  costBasisEur: (h, base) =>
    formatCurrency(h.costBasisBase || h.costBasisEur, base),
  stopLoss: (h) => h.stopLoss || "",
  tp1: (h) => h.tp1 || "",
  tp2: (h) => h.tp2 || "",
  tp3: (h) => h.tp3 || "",
  tp4: (h) => h.tp4 || "",
};

/**
 * Construit le CSV pour les positions données, restreint aux colonnes
 * connues parmi `columnIds` (ordre respecté — reflète la vue courante).
 */
export function holdingsToCsv(
  holdings: Holding[],
  columnIds: string[],
  baseCurrency: string
): string {
  const knownIds = columnIds.filter((id) => COLUMN_VALUES[id] != null);
  const headerLabels = knownIds.map(
    (id) => HOLDINGS_COLUMN_META.find((c) => c.id === id)?.label ?? id
  );
  const lines = [headerLabels.map(csvField).join(CSV_DELIMITER)];
  for (const h of holdings) {
    const row = knownIds.map((id) =>
      csvField(COLUMN_VALUES[id]!(h, baseCurrency))
    );
    lines.push(row.join(CSV_DELIMITER));
  }
  return lines.join("\r\n");
}
