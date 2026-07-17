import { parseDate, parseNumber } from "../normalize";
import { mapTxType, normalizeTicker } from "../presets";
import type { CanonicalTxKind, ColumnMapping, TransactionImport } from "../types";
import type { TxType } from "../../accounting/types";

export function getByRole(
  row: Record<string, string>,
  map: ColumnMapping,
  role: string
): string {
  for (const [header, r] of Object.entries(map)) {
    if (r === role) return row[header] ?? "";
  }
  return "";
}

export function txTypeToCanonical(t: TxType | null): CanonicalTxKind {
  if (t === "ACHAT") return "BUY";
  if (t === "VENTE") return "SELL";
  if (t === "DIVIDENDE" || t === "COUPON" || t === "LOYER" || t === "INTERET")
    return "DIVIDEND";
  // REWARD reste OTHER au niveau canonique (le commit UI utilise les drafts mapCsvToDrafts)
  return "OTHER";
}

export function rowToTransactionImport(
  row: Record<string, string>,
  map: ColumnMapping,
  line: number
): { tx: TransactionImport | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dateRaw = getByRole(row, map, "date");
  const typeRaw = getByRole(row, map, "type");
  const sideRaw = getByRole(row, map, "side");
  const tickerRaw = getByRole(row, map, "ticker");
  const nameRaw = getByRole(row, map, "name");
  const qtyRaw = getByRole(row, map, "quantity");
  const priceRaw = getByRole(row, map, "unitPrice");
  const feesRaw = getByRole(row, map, "fees");
  const currencyRaw = getByRole(row, map, "currency");
  const cashRaw = getByRole(row, map, "cashAmount");
  const notesRaw = getByRole(row, map, "notes");
  const descRaw = getByRole(row, map, "description");

  const date = parseDate(dateRaw);
  if (!date) errors.push("Date invalide");

  const txType = mapTxType(typeRaw, sideRaw || null);
  const kind = txTypeToCanonical(txType);
  if (kind === "OTHER" && !txType) errors.push("Type non reconnu");

  const ticker = normalizeTicker(tickerRaw) || nameRaw.trim() || "";
  if (!ticker && kind !== "OTHER") errors.push("Ticker manquant");

  let quantity = parseNumber(qtyRaw) ?? 0;
  let price = parseNumber(priceRaw);
  const fees = parseNumber(feesRaw) ?? 0;
  const cash = parseNumber(cashRaw);

  if (price == null && quantity && cash != null && quantity !== 0) {
    price = Math.abs(cash / quantity);
    warnings.push("Prix déduit du montant");
  }
  if (price == null) price = 0;
  if (!quantity && cash != null && price) {
    quantity = Math.abs(cash / price);
  }

  if ((kind === "BUY" || kind === "SELL") && quantity <= 0) {
    errors.push("Quantité invalide");
  }

  if (errors.length > 0 || !date) {
    return { tx: null, errors, warnings };
  }

  const tx: TransactionImport = {
    date,
    type: kind === "OTHER" ? "BUY" : kind, // fallback never for empty
    ticker: ticker || "UNKNOWN",
    quantity: Math.abs(quantity),
    price: Math.abs(price),
    fees: fees || undefined,
    currency: (currencyRaw || "EUR").trim().toUpperCase().slice(0, 3) || "EUR",
    name: nameRaw.trim() || undefined,
    cashAmount: cash != null ? Math.abs(cash) : undefined,
    notes: [notesRaw, descRaw].filter(Boolean).join(" · ") || undefined,
    rawType: typeRaw || sideRaw || undefined,
    line,
  };

  // If OTHER with cash only, still emit for debugging — caller may filter
  if (kind === "OTHER") {
    tx.type = "OTHER";
  }

  return { tx, errors, warnings };
}
