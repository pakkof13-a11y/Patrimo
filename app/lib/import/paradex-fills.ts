/**
 * Paradex (StarkNet) — Fills export → CSV plat compatible mapCsvToDrafts.
 *
 * Le champ "market" encode l'actif + le type d'instrument
 * (BTC-USD-PERP, BTC-USD-118000-C, DIME-USD…) et doit être décomposé
 * avant le pipeline générique alias → ColumnRole, qui ne sait mapper
 * qu'une colonne entière vers un rôle (pas d'extraction de sous-chaîne).
 */

import { normalizeHeader, type ParsedCsv } from "./csv-parse";
import { parseParadexMarket } from "./adapters/paradex-adapter";

export type ParadexExpandResult = {
  matched: boolean;
  csv: ParsedCsv;
  fillCount: number;
  warnings: string[];
};

const FLAT_HEADERS = [
  "Date",
  "Ticker",
  "Side",
  "Quantity",
  "Price",
  "Fee",
  "Currency",
  "Notes",
] as const;

/** Détecte un export Fills Paradex (fill_type=FILL + realized_funding). */
export function isParadexFillsExport(headers: string[]): boolean {
  const keys = headers.map((h) => normalizeHeader(h));
  return keys.includes("fill_type") && keys.includes("realized_funding");
}

export function expandParadexFills(
  headers: string[],
  rows: Record<string, string>[]
): ParadexExpandResult {
  const warnings: string[] = [];
  if (!isParadexFillsExport(headers)) {
    return {
      matched: false,
      csv: { headers: [], rows: [], delimiter: ",", rawLineCount: 0 },
      fillCount: 0,
      warnings: [],
    };
  }

  const findHeader = (key: string) =>
    headers.find((h) => normalizeHeader(h) === key) || key;

  const createdAtHeader = findHeader("created_at");
  const sideHeader = findHeader("side");
  const marketHeader = findHeader("market");
  const priceHeader = findHeader("price");
  const sizeHeader = findHeader("size");
  const feeHeader = findHeader("fee");
  const fillTypeHeader = findHeader("fill_type");
  const realizedPnlHeader = findHeader("realized_pnl");
  const realizedFundingHeader = findHeader("realized_funding");
  const accountHeader = findHeader("account");

  const flatRows: Record<string, string>[] = [];
  let fillCount = 0;

  rows.forEach((row, idx) => {
    const lineNum = idx + 2;
    const fillType = (row[fillTypeHeader] || "").trim().toUpperCase();
    if (fillType !== "FILL") return;

    const dateRaw = row[createdAtHeader] || "";
    const sideRaw = (row[sideHeader] || "").trim().toUpperCase();
    const marketRaw = row[marketHeader] || "";
    const marketInfo = parseParadexMarket(marketRaw);

    if (!dateRaw || !sideRaw || !marketInfo) {
      warnings.push(`L${lineNum}: ligne Paradex ignorée (market/side/date invalide)`);
      return;
    }

    const feeNum = Number(String(row[feeHeader] || "0").replace(/"/g, ""));
    const rebate = Number.isFinite(feeNum) && feeNum < 0 ? Math.abs(feeNum) : 0;
    const feeAbs = Number.isFinite(feeNum) && feeNum > 0 ? feeNum : 0;

    const realizedPnl = row[realizedPnlHeader]
      ? Number(String(row[realizedPnlHeader]).replace(/"/g, ""))
      : NaN;
    const realizedFunding = row[realizedFundingHeader]
      ? Number(String(row[realizedFundingHeader]).replace(/"/g, ""))
      : NaN;
    const account = (row[accountHeader] || "").trim();

    const noteParts: string[] = [marketInfo.kind];
    if (marketInfo.strike != null) noteParts.push(`strike ${marketInfo.strike}`);
    if (rebate > 0) noteParts.push(`rebate maker ${rebate}`);
    if (Number.isFinite(realizedPnl) && realizedPnl !== 0)
      noteParts.push(`PnL réalisé ${realizedPnl}`);
    if (Number.isFinite(realizedFunding) && realizedFunding !== 0)
      noteParts.push(`funding réalisé ${realizedFunding}`);
    if (account) noteParts.push(`wallet ${account}`);

    flatRows.push({
      Date: dateRaw,
      Ticker: marketInfo.asset,
      Side: sideRaw,
      Quantity: String(row[sizeHeader] || "").replace(/"/g, ""),
      Price: String(row[priceHeader] || "").replace(/"/g, ""),
      Fee: String(feeAbs),
      Currency: "USD",
      Notes: noteParts.join(" · "),
    });
    fillCount++;
  });

  if (fillCount === 0) {
    warnings.push("Export Paradex détecté mais aucune ligne FILL exploitable");
  } else {
    warnings.push(`Paradex Fills : ${fillCount} exécution(s)`);
  }

  return {
    matched: true,
    csv: {
      headers: [...FLAT_HEADERS],
      rows: flatRows,
      delimiter: ",",
      rawLineCount: rows.length,
    },
    fillCount,
    warnings,
  };
}
