/**
 * Hyperliquid Trade/Funding history → CSV plat compatible mapCsvToDrafts.
 * Le préset générique alias→ColumnRole ne sait pas dériver un type/side à
 * partir d'un texte libre ("Open Long"/"Close Short") ni du signe d'un
 * montant (payment funding) : on pré-aplati donc en un texte de type
 * directement reconnu par mapTxType (ACHAT/VENTE/INTERET/FRAIS).
 */

import { normalizeHeader, type ParsedCsv } from "./csv-parse";

export type HyperliquidExpandResult = {
  matched: boolean;
  csv: ParsedCsv;
  rowCount: number;
  warnings: string[];
};

function normalizeHlTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/\/(USDC|USDT|USD|EUR|BTC|ETH)$/, "");
}

const TRADE_HEADERS = ["Date", "Ticker", "Type", "Quantity", "Price", "Fee", "Currency"] as const;

export function isHyperliquidTradeExport(headers: string[]): boolean {
  const keys = headers.map((h) => normalizeHeader(h));
  return (
    keys.includes("time") &&
    keys.includes("coin") &&
    keys.includes("dir") &&
    keys.includes("px") &&
    keys.includes("sz") &&
    keys.includes("closedpnl")
  );
}

/** "Open Long"/"Buy" → ACHAT, "Close Long"/"Sell" → VENTE, Short* → ignoré. */
function mapHlTradeDir(dir: string): "ACHAT" | "VENTE" | null {
  const d = dir.trim().toLowerCase();
  if (d === "buy" || d === "open long") return "ACHAT";
  if (d === "sell" || d === "close long") return "VENTE";
  return null;
}

export function expandHyperliquidTrade(
  headers: string[],
  rows: Record<string, string>[]
): HyperliquidExpandResult {
  const warnings: string[] = [];
  if (!isHyperliquidTradeExport(headers)) {
    return {
      matched: false,
      csv: { headers: [], rows: [], delimiter: ",", rawLineCount: 0 },
      rowCount: 0,
      warnings: [],
    };
  }
  const find = (key: string) => headers.find((h) => normalizeHeader(h) === key) || key;
  const timeH = find("time");
  const coinH = find("coin");
  const dirH = find("dir");
  const pxH = find("px");
  const szH = find("sz");
  const feeH = find("fee");

  const flatRows: Record<string, string>[] = [];
  rows.forEach((row, idx) => {
    const lineNum = idx + 2;
    const dirRaw = row[dirH] || "";
    const type = mapHlTradeDir(dirRaw);
    if (!type) {
      warnings.push(`L${lineNum}: direction '${dirRaw}' non supportée (positions short)`);
      return;
    }
    const ticker = normalizeHlTicker(row[coinH] || "");
    if (!ticker) {
      warnings.push(`L${lineNum}: ticker manquant`);
      return;
    }
    flatRows.push({
      Date: row[timeH] || "",
      Ticker: ticker,
      Type: type,
      Quantity: row[szH] || "",
      Price: row[pxH] || "",
      Fee: row[feeH] || "0",
      Currency: "USD",
    });
  });

  if (flatRows.length === 0) {
    warnings.push("Export Hyperliquid Trade History détecté mais aucune ligne exploitable");
  } else {
    warnings.push(`Hyperliquid Trade History : ${flatRows.length} trade(s)`);
  }

  return {
    matched: true,
    csv: { headers: [...TRADE_HEADERS], rows: flatRows, delimiter: ",", rawLineCount: rows.length },
    rowCount: flatRows.length,
    warnings,
  };
}

const FUNDING_HEADERS = ["Date", "Ticker", "Type", "CashAmount", "Currency", "Notes"] as const;

export function isHyperliquidFundingExport(headers: string[]): boolean {
  const keys = headers.map((h) => normalizeHeader(h));
  return (
    keys.includes("time") &&
    keys.includes("coin") &&
    keys.includes("side") &&
    keys.includes("payment") &&
    keys.includes("rate")
  );
}

export function expandHyperliquidFunding(
  headers: string[],
  rows: Record<string, string>[]
): HyperliquidExpandResult {
  const warnings: string[] = [];
  if (!isHyperliquidFundingExport(headers)) {
    return {
      matched: false,
      csv: { headers: [], rows: [], delimiter: ",", rawLineCount: 0 },
      rowCount: 0,
      warnings: [],
    };
  }
  const find = (key: string) => headers.find((h) => normalizeHeader(h) === key) || key;
  const timeH = find("time");
  const coinH = find("coin");
  const paymentH = find("payment");

  const flatRows: Record<string, string>[] = [];
  rows.forEach((row, idx) => {
    const lineNum = idx + 2;
    const ticker = normalizeHlTicker(row[coinH] || "");
    const payment = Number(String(row[paymentH] || "").replace(",", "."));
    if (!ticker || !Number.isFinite(payment) || payment === 0) {
      warnings.push(`L${lineNum}: payment/ticker invalide`);
      return;
    }
    flatRows.push({
      Date: row[timeH] || "",
      Ticker: ticker,
      Type: payment > 0 ? "INTERET" : "FRAIS",
      CashAmount: String(Math.abs(payment)),
      Currency: "USD",
      Notes: payment > 0 ? "Funding income" : "Funding fee",
    });
  });

  if (flatRows.length === 0) {
    warnings.push("Export Hyperliquid Funding History détecté mais aucune ligne exploitable");
  } else {
    warnings.push(`Hyperliquid Funding History : ${flatRows.length} règlement(s)`);
  }

  return {
    matched: true,
    csv: { headers: [...FUNDING_HEADERS], rows: flatRows, delimiter: ",", rawLineCount: rows.length },
    rowCount: flatRows.length,
    warnings,
  };
}
