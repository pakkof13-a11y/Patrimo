/**
 * Nexo adapter.
 * Auto-detects via "NXT" prefix in Transaction column.
 * Parses transaction types, handles Details field extraction, and processes date/time.
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
  id: "nexo",
  label: "Nexo",
  description: "Nexo Transactions CSV (Transaction, Type, Input/Output Currency & Amount, Date / Time)",
};

function mapNexoType(type: string): "BUY" | "SELL" | "OTHER" {
  const t = type.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Interest-related types
  if (
    t.includes("interest") ||
    t.includes("interet") ||
    t.includes("fixedterm") ||
    t.includes("additional")
  ) {
    return "BUY"; // Interest income → canonical DIVIDEND
  }

  // Deposit/Top-up types (inbound cash or crypto) — handle "top up" with spaces
  if (
    t.includes("deposit") ||
    t.includes("depot") ||
    /top\s*up/.test(t) ||
    t.includes("topup") ||
    t.includes("transfer") && t.includes("in")
  ) {
    return "BUY"; // Inbound → canonical BUY (asset increase)
  }

  // Withdrawal/Retrait types (outbound)
  if (
    t.includes("withdrawal") ||
    t.includes("retrait") ||
    (t.includes("transfer") && t.includes("out"))
  ) {
    return "SELL"; // Outbound → canonical SELL (asset decrease)
  }

  // Exchange/Swap types
  if (
    t.includes("exchange") ||
    t.includes("swap") ||
    t.includes("convert") ||
    t.includes("conversion")
  ) {
    return "BUY"; // Exchange → canonical BUY (receiving asset)
  }

  // Liquidation
  if (t.includes("liquidation")) {
    return "SELL"; // Liquidation → canonical SELL
  }

  // Loan operations
  if (t.includes("loan") || t.includes("emprunt")) {
    if (t.includes("disbursement") || t.includes("decaissement")) {
      return "BUY"; // Loan disbursement → receiving funds
    }
    if (t.includes("repayment") || t.includes("remboursement")) {
      return "SELL"; // Loan repayment → paying back
    }
  }

  return "OTHER";
}

function extractHashFromDetails(details: string): string | undefined {
  if (!details) return undefined;
  const match = details.match(/0x[a-fA-F0-9]{40,}/);
  return match ? match[0] : undefined;
}

function extractOnChainHash(details: string): string | null {
  const hash = extractHashFromDetails(details);
  return hash || null;
}

export const nexoAdapter: PlatformCsvAdapter = {
  meta,

  detect(headers: string[]): number {
    const keys = headers.map((h) => normalizeHeader(h));
    const hasTransaction = keys.includes("transaction");
    const hasType = keys.includes("type");
    const hasDateTime = keys.some((k) => k === "date_time" || k === "date_time_utc");
    const hasInputCurrency = keys.some((k) => k.includes("input_currency"));

    if (hasTransaction && hasType && hasDateTime) return 96;
    if (hasTransaction && hasType && hasInputCurrency) return 93;
    if (hasTransaction && hasType) return 90;
    return 0;
  },

  parse(input: AdapterParseInput): AdapterParseResult {
    const transactions: TransactionImport[] = [];
    const warnings: string[] = [];
    const columnMap: ColumnMapping = {};

    const headers = input.headers;
    let txIdHeader = "";
    let typeHeader = "";
    let dateHeader = "";
    let inputCurrencyHeader = "";
    let inputAmountHeader = "";
    let outputCurrencyHeader = "";
    let outputAmountHeader = "";
    let detailsHeader = "";
    let usdEquivalentHeader = "";

    // Build header map by finding matching columns
    for (const h of headers) {
      const k = normalizeHeader(h);
      if (k === "transaction") {
        txIdHeader = h;
        columnMap[h] = "ignore";
      } else if (k === "type") {
        typeHeader = h;
        columnMap[h] = "type";
      } else if (k === "date_time_utc" || k === "date_time") {
        dateHeader = h;
        columnMap[h] = "date";
      } else if (k.includes("input_currency")) {
        inputCurrencyHeader = h;
        columnMap[h] = "ticker";
      } else if (k.includes("input_amount")) {
        inputAmountHeader = h;
        columnMap[h] = "quantity";
      } else if (k.includes("output_currency")) {
        outputCurrencyHeader = h;
        columnMap[h] = "name";
      } else if (k.includes("output_amount")) {
        outputAmountHeader = h;
        columnMap[h] = "cashAmount";
      } else if (k === "details") {
        detailsHeader = h;
        columnMap[h] = "notes";
      } else if (k === "usd_equivalent") {
        usdEquivalentHeader = h;
        columnMap[h] = "ignore";
      }
    }

    // Validate auto-detection by checking for NXT prefix
    const hasNexoTransactions = input.rows.some((row) => {
      const txId = row[txIdHeader] || "";
      return txId.startsWith("NXT");
    });

    if (!hasNexoTransactions) {
      warnings.push(
        "Aucune transaction avec préfixe NXT détectée - ce fichier peut ne pas être Nexo"
      );
    }

    input.rows.forEach((row, idx) => {
      const lineNum = idx + 2;
      const dateRaw = row[dateHeader] || "";
      const typeRaw = row[typeHeader] || "";
      const inputCurrencyRaw = row[inputCurrencyHeader] || "";
      const inputAmountRaw = row[inputAmountHeader] || "";
      const outputCurrencyRaw = row[outputCurrencyHeader] || "";
      const outputAmountRaw = row[outputAmountHeader] || "";
      const detailsRaw = row[detailsHeader] || "";
      const usdEquivalentRaw = row[usdEquivalentHeader] || "";

      const date = parseDate(dateRaw);
      if (!date) {
        warnings.push(`L${lineNum}: Date invalide`);
        return;
      }

      const type = mapNexoType(typeRaw);
      if (type === "OTHER") {
        warnings.push(`L${lineNum}: Type '${typeRaw}' non reconnu`);
        return;
      }

      // Determine ticker and amount based on transaction direction
      let ticker = inputCurrencyRaw.trim().toUpperCase();
      let quantity = parseNumber(inputAmountRaw);
      let cashAmount = parseNumber(usdEquivalentRaw);

      // For exchanges/swaps, prefer output currency
      if (type === "BUY" && outputCurrencyRaw && outputAmountRaw) {
        const outputQty = parseNumber(outputAmountRaw);
        if (outputQty != null && outputQty > 0) {
          ticker = outputCurrencyRaw.trim().toUpperCase();
          quantity = outputQty;
        }
      }

      // For withdrawals/retraits, use output
      if (type === "SELL" && outputCurrencyRaw && outputAmountRaw) {
        const outputQty = parseNumber(outputAmountRaw);
        if (outputQty != null && outputQty > 0) {
          ticker = outputCurrencyRaw.trim().toUpperCase();
          quantity = outputQty;
        }
      }

      if (!ticker || !quantity || quantity <= 0) {
        warnings.push(`L${lineNum}: Devise/montant invalide`);
        return;
      }

      const onChainHash = extractOnChainHash(detailsRaw);
      const notes = [detailsRaw, onChainHash ? `Hash: ${onChainHash}` : ""]
        .filter(Boolean)
        .join(" · ");

      const tx: TransactionImport = {
        date,
        type,
        ticker,
        quantity,
        price: 0,
        currency: "USD",
        cashAmount: cashAmount ?? undefined,
        notes: notes || undefined,
        rawType: typeRaw,
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
