/**
 * Hyperliquid Trade History adapter.
 * Auto-detects via headers: time, coin, dir, px, sz, ntl, fee, closedPnl
 * Maps trade directions: Open Long/Buy → BUY, Open Short → SHORT_OPEN, Close Long/Sell → SELL, Close Short → SHORT_CLOSE
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
  id: "hyperliquid_trade",
  label: "Hyperliquid (Trade History)",
  description: "Trade history export (time, coin, dir, px, sz, ntl, fee, closedPnl)",
};

function mapDirection(dir: string): "BUY" | "SELL" | "OTHER" {
  const d = dir.trim().toLowerCase();
  if (d === "buy" || d === "open long") return "BUY";
  if (d === "sell" || d === "close long") return "SELL";
  // Open Short and Close Short are mapped to OTHER (derivatives)
  return "OTHER";
}

function normalizeTicker(raw: string): string {
  // Remove /USDC or similar suffixes
  const t = raw.trim().toUpperCase();
  return t.replace(/\/(USDC|USDT|USD|EUR|BTC|ETH)$/, "");
}

export const hyperliquidTradeAdapter: PlatformCsvAdapter = {
  meta,

  detect(headers: string[]): number {
    const keys = headers.map((h) => normalizeHeader(h));
    const required = ["time", "coin", "dir", "px", "sz", "ntl", "fee", "closedpnl"];
    const hasAll = required.every((r) => keys.includes(r));
    return hasAll ? 98 : 0;
  },

  parse(input: AdapterParseInput): AdapterParseResult {
    const transactions: TransactionImport[] = [];
    const warnings: string[] = [];
    const columnMap: ColumnMapping = {};

    const headers = input.headers;
    for (const h of headers) {
      const k = normalizeHeader(h);
      if (k === "time") columnMap[h] = "date";
      if (k === "coin") columnMap[h] = "ticker";
      if (k === "px") columnMap[h] = "unitPrice";
      if (k === "sz") columnMap[h] = "quantity";
      if (k === "ntl") columnMap[h] = "cashAmount";
      if (k === "fee") columnMap[h] = "fees";
      if (k === "dir") columnMap[h] = "type";
    }

    input.rows.forEach((row, idx) => {
      const lineNum = idx + 2;
      const dateRaw = row[headers.find((h) => normalizeHeader(h) === "time") || "time"] || "";
      const coinRaw =
        row[headers.find((h) => normalizeHeader(h) === "coin") || "coin"] || "";
      const dirRaw = row[headers.find((h) => normalizeHeader(h) === "dir") || "dir"] || "";
      const pxRaw = row[headers.find((h) => normalizeHeader(h) === "px") || "px"] || "";
      const szRaw = row[headers.find((h) => normalizeHeader(h) === "sz") || "sz"] || "";
      const ntlRaw = row[headers.find((h) => normalizeHeader(h) === "ntl") || "ntl"] || "";
      const feeRaw = row[headers.find((h) => normalizeHeader(h) === "fee") || "fee"] || "";

      const date = parseDate(dateRaw);
      if (!date) {
        warnings.push(`L${lineNum}: Date invalide`);
        return;
      }

      const type = mapDirection(dirRaw);
      if (type === "OTHER") {
        warnings.push(
          `L${lineNum}: Direction '${dirRaw}' non supportée (Short positions)`
        );
        return;
      }

      const ticker = normalizeTicker(coinRaw);
      if (!ticker) {
        warnings.push(`L${lineNum}: Ticker manquant`);
        return;
      }

      const quantity = parseNumber(szRaw);
      if (quantity == null || quantity <= 0) {
        warnings.push(`L${lineNum}: Quantité invalide`);
        return;
      }

      const price = parseNumber(pxRaw);
      if (price == null || price <= 0) {
        warnings.push(`L${lineNum}: Prix invalide`);
        return;
      }

      const cashAmount = parseNumber(ntlRaw);
      const fees = parseNumber(feeRaw) ?? 0;

      const tx: TransactionImport = {
        date,
        type,
        ticker,
        quantity,
        price,
        fees: fees > 0 ? fees : undefined,
        currency: "USD",
        cashAmount: cashAmount ?? undefined,
        rawType: dirRaw,
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
