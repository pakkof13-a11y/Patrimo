/**
 * Paradex (StarkNet) — Fills export adapter.
 * Auto-detects via "fill_type" column with FILL values + "realized_funding" column.
 * Dates already UTC (ISO 8601, ex. "2026-07-11T21:13:00.167Z").
 */

import { normalizeHeader } from "../csv-parse";
import type {
  AdapterParseInput,
  AdapterParseResult,
  ColumnMapping,
  PlatformCsvAdapter,
  PlatformAdapterMeta,
  TransactionImport,
} from "../types";
import { parseDate, parseNumber } from "../normalize";

const meta: PlatformAdapterMeta = {
  id: "paradex",
  label: "Paradex (Fills — StarkNet)",
  description:
    "Export Fills Paradex (id, side, liquidity, market, price, size, fee, created_at, fill_type, realized_pnl, realized_funding, account…)",
};

export type ParadexMarketKind = "PERP" | "OPTION_CALL" | "OPTION_PUT" | "SPOT";

export type ParadexMarketInfo = {
  asset: string;
  kind: ParadexMarketKind;
  strike?: number;
};

/**
 * Parse le champ "market" Paradex :
 *   BTC-USD-PERP        → { asset: BTC, kind: PERP }
 *   BTC-USD-118000-C    → { asset: BTC, kind: OPTION_CALL, strike: 118000 }
 *   BTC-USD-125000-P    → { asset: BTC, kind: OPTION_PUT, strike: 125000 }
 *   DIME-USD            → { asset: DIME, kind: SPOT }
 */
export function parseParadexMarket(market: string): ParadexMarketInfo | null {
  const segments = market.trim().toUpperCase().split("-");
  if (segments.length < 2) return null;
  const asset = segments[0]!;

  if (segments.length === 4) {
    const strikeRaw = segments[2];
    const optionType = segments[3];
    const strike = Number(strikeRaw);
    if (!Number.isFinite(strike)) return null;
    if (optionType === "C") return { asset, kind: "OPTION_CALL", strike };
    if (optionType === "P") return { asset, kind: "OPTION_PUT", strike };
    return null;
  }

  if (segments.length === 3) {
    if (segments[2] === "PERP") return { asset, kind: "PERP" };
    return null;
  }

  if (segments.length === 2) {
    return { asset, kind: "SPOT" };
  }

  return null;
}

export const paradexAdapter: PlatformCsvAdapter = {
  meta,

  detect(headers: string[]): number {
    const keys = headers.map((h) => normalizeHeader(h));
    const hasFillType = keys.includes("fill_type");
    const hasRealizedFunding = keys.includes("realized_funding");
    if (hasFillType && hasRealizedFunding) return 97;
    return 0;
  },

  parse(input: AdapterParseInput): AdapterParseResult {
    const transactions: TransactionImport[] = [];
    const warnings: string[] = [];
    const columnMap: ColumnMapping = {};

    const headers = input.headers;
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

    columnMap[createdAtHeader] = "date";
    columnMap[marketHeader] = "ticker";
    columnMap[priceHeader] = "unitPrice";
    columnMap[sizeHeader] = "quantity";
    columnMap[feeHeader] = "fees";
    columnMap[sideHeader] = "type";

    input.rows.forEach((row, idx) => {
      const lineNum = idx + 2;
      const fillType = (row[fillTypeHeader] || "").trim().toUpperCase();
      if (fillType !== "FILL") {
        warnings.push(`L${lineNum}: fill_type '${fillType}' ignoré (non FILL)`);
        return;
      }

      const dateRaw = row[createdAtHeader] || "";
      const date = parseDate(dateRaw);
      if (!date) {
        warnings.push(`L${lineNum}: Date invalide`);
        return;
      }

      const sideRaw = (row[sideHeader] || "").trim().toUpperCase();
      const type = sideRaw === "BUY" ? "BUY" : sideRaw === "SELL" ? "SELL" : null;
      if (!type) {
        warnings.push(`L${lineNum}: side '${sideRaw}' non reconnu`);
        return;
      }

      const marketRaw = row[marketHeader] || "";
      const marketInfo = parseParadexMarket(marketRaw);
      if (!marketInfo) {
        warnings.push(`L${lineNum}: market '${marketRaw}' non reconnu`);
        return;
      }

      const price = parseNumber(row[priceHeader]);
      if (price == null || price <= 0) {
        warnings.push(`L${lineNum}: Prix invalide`);
        return;
      }

      const quantity = parseNumber(row[sizeHeader]);
      if (quantity == null || quantity <= 0) {
        warnings.push(`L${lineNum}: Quantité invalide`);
        return;
      }

      const feeRaw = parseNumber(row[feeHeader]) ?? 0;
      // fee négatif = rebate maker → pas un coût, tracé en note
      const fees = feeRaw > 0 ? feeRaw : undefined;
      const rebate = feeRaw < 0 ? Math.abs(feeRaw) : 0;

      const realizedPnl = parseNumber(row[realizedPnlHeader]);
      const realizedFunding = parseNumber(row[realizedFundingHeader]);
      const account = (row[accountHeader] || "").trim();

      const noteParts: string[] = [marketInfo.kind];
      if (marketInfo.strike != null) noteParts.push(`strike ${marketInfo.strike}`);
      if (rebate > 0) noteParts.push(`rebate maker ${rebate}`);
      if (realizedPnl != null && realizedPnl !== 0)
        noteParts.push(`PnL réalisé ${realizedPnl}`);
      if (realizedFunding != null && realizedFunding !== 0)
        noteParts.push(`funding réalisé ${realizedFunding}`);
      if (account) noteParts.push(`wallet ${account}`);

      const tx: TransactionImport = {
        date,
        type,
        ticker: marketInfo.asset,
        quantity,
        price,
        fees,
        currency: "USD",
        notes: noteParts.join(" · "),
        rawType: marketRaw,
        line: lineNum,
      };

      transactions.push(tx);
    });

    return {
      transactions,
      columnMap,
      warnings,
      needsManualMapping: false,
      confidence: "high",
    };
  },
};
