/**
 * Hyperliquid Funding History adapter.
 * Auto-detects via headers: time, coin, sz, side, payment, rate
 * Maps funding payments: payment > 0 → FUNDING_INCOME (as INTERET), payment < 0 → FUNDING_FEE (as FRAIS)
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
  id: "hyperliquid_funding",
  label: "Hyperliquid (Funding History)",
  description: "Funding history export (time, coin, sz, side, payment, rate)",
};

function mapPaymentType(payment: number): "BUY" | "SELL" {
  // payment > 0 = income to trader (funding received) → DIVIDEND equivalent
  // payment < 0 = fees paid by trader → FRAIS equivalent
  // For canonical types, we use SELL for fees and BUY for income
  return payment > 0 ? "BUY" : "SELL";
}

function normalizeTicker(raw: string): string {
  // Remove /USDC or similar suffixes
  const t = raw.trim().toUpperCase();
  return t.replace(/\/(USDC|USDT|USD|EUR|BTC|ETH)$/, "");
}

export const hyperliquidFundingAdapter: PlatformCsvAdapter = {
  meta,

  detect(headers: string[]): number {
    const keys = headers.map((h) => normalizeHeader(h));
    const required = ["time", "coin", "sz", "side", "payment", "rate"];
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
      if (k === "payment") columnMap[h] = "cashAmount";
    }

    input.rows.forEach((row, idx) => {
      const lineNum = idx + 2;
      const dateRaw = row[headers.find((h) => normalizeHeader(h) === "time") || "time"] || "";
      const coinRaw =
        row[headers.find((h) => normalizeHeader(h) === "coin") || "coin"] || "";
      const paymentRaw =
        row[headers.find((h) => normalizeHeader(h) === "payment") || "payment"] || "";

      const date = parseDate(dateRaw);
      if (!date) {
        warnings.push(`L${lineNum}: Date invalide`);
        return;
      }

      const ticker = normalizeTicker(coinRaw);
      if (!ticker) {
        warnings.push(`L${lineNum}: Ticker manquant`);
        return;
      }

      const payment = parseNumber(paymentRaw);
      if (payment == null) {
        warnings.push(`L${lineNum}: Payment invalide`);
        return;
      }

      if (payment === 0) {
        warnings.push(`L${lineNum}: Payment est zéro`);
        return;
      }

      const type = mapPaymentType(payment);
      const absPayment = Math.abs(payment);

      const tx: TransactionImport = {
        date,
        type,
        ticker,
        quantity: 0, // Funding is pure cash, no quantity
        price: 0,
        fees: type === "SELL" ? absPayment : undefined,
        currency: "USD",
        cashAmount: absPayment,
        rawType: payment > 0 ? "FUNDING_INCOME" : "FUNDING_FEE",
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
