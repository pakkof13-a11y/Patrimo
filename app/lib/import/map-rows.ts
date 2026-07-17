import type { ParsedCsv } from "./csv-parse";
import {
  extractCurrencyHint,
  parseDate,
  parseNumber,
  toIsoLocal,
} from "./normalize";
import {
  getFormat,
  guessAssetClass,
  inferAssetFromDescription,
  mapTxType,
  normalizeTicker,
  resolveColumnMap,
  type ImportFormatId,
} from "./presets";
import type { TxType } from "../accounting/types";

export type ImportDraftRow = {
  line: number;
  selected: boolean;
  status: "ok" | "warning" | "error";
  errors: string[];
  warnings: string[];
  type: TxType | null;
  occurredAt: string | null;
  ticker: string | null;
  name: string | null;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  currency: string;
  cashAmount: string | null;
  notes: string | null;
  assetClass: "ACTIONS" | "CRYPTO" | "IMMOBILIER" | "OBLIGATIONS" | "CASH" | "AUTRE";
  raw: Record<string, string>;
};

function getByRole(
  row: Record<string, string>,
  map: Record<string, string>,
  role: string
): string {
  for (const [header, r] of Object.entries(map)) {
    if (r === role) return row[header] ?? "";
  }
  return "";
}

/** Fiat codes that should not be treated as crypto tickers */
const FIAT = new Set([
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "BRL",
  "MXN",
  "INR",
  "KRW",
  "CNY",
  "HKD",
  "SGD",
  "NZD",
  "ZAR",
]);

function parseQtyField(qtyRaw: string): number | null {
  let qty = parseNumber(qtyRaw);
  if (qty == null && qtyRaw) {
    const m = qtyRaw.replace(/\s/g, "").match(/^([\d.,]+)([A-Za-z]+)?$/);
    if (m) qty = parseNumber(m[1]);
  }
  return qty;
}

export function mapCsvToDrafts(
  csv: ParsedCsv,
  formatId: ImportFormatId | string,
  options?: { columnMapOverride?: Record<string, string> | null }
): { rows: ImportDraftRow[]; columnMap: Record<string, string>; formatLabel: string } {
  const columnMap = resolveColumnMap(
    csv.headers,
    formatId,
    options?.columnMapOverride as Parameters<typeof resolveColumnMap>[2]
  ) as Record<string, string>;
  const formatLabel = getFormat(formatId as ImportFormatId).label;
  const rows: ImportDraftRow[] = [];

  csv.rows.forEach((raw, idx) => {
    const line = idx + 2; // header is line 1
    const errors: string[] = [];
    const warnings: string[] = [];

    const dateRaw = getByRole(raw, columnMap, "date");
    let typeRaw = getByRole(raw, columnMap, "type");
    let sideRaw = getByRole(raw, columnMap, "side");
    let tickerRaw = getByRole(raw, columnMap, "ticker");
    const nameRaw = getByRole(raw, columnMap, "name");
    const qtyRaw = getByRole(raw, columnMap, "quantity");
    const priceRaw = getByRole(raw, columnMap, "unitPrice");
    const feesRaw = getByRole(raw, columnMap, "fees");
    let currencyRaw = getByRole(raw, columnMap, "currency");
    const cashRaw = getByRole(raw, columnMap, "cashAmount");
    const notesRaw = getByRole(raw, columnMap, "notes");
    const classRaw = getByRole(raw, columnMap, "assetClass");
    const descriptionRaw = getByRole(raw, columnMap, "description");
    const productRaw = getByRole(raw, columnMap, "product");

    // ── Format-specific enrichment ──────────────────────────────────────────
    if (formatId === "revolut") {
      // Product column can be "Current", "BTC", "Savings", etc.
      if (!tickerRaw && productRaw && !/current|savings|pocket|metal|junior/i.test(productRaw)) {
        tickerRaw = productRaw;
      }
      if (descriptionRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw);
        if (!tickerRaw && inferred.ticker) tickerRaw = inferred.ticker;
        if (!sideRaw && inferred.side) sideRaw = inferred.side;
      }
      // Revolut Type EXCHANGE without side → try description
      if (/^exchange$/i.test(typeRaw) && !sideRaw && descriptionRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw);
        if (inferred.side) sideRaw = inferred.side;
      }
      // Card / transfer cash flows
      if (/^transfer$/i.test(typeRaw) && !sideRaw) {
        const amt = parseNumber(cashRaw);
        if (amt != null && amt > 0) typeRaw = "deposit";
        if (amt != null && amt < 0) typeRaw = "withdraw";
      }
      if (/top.?up/i.test(typeRaw)) typeRaw = "topup";
      if (/card.?payment/i.test(typeRaw)) {
        // Personal expense — skip as non-portfolio unless user wants cash out
        typeRaw = "withdraw";
      }
      // Export crypto FR : devise souvent dans Price/Value (« 1,00 CHF », « 0,35€ »)
      if (!currencyRaw) {
        const hint = extractCurrencyHint(
          priceRaw,
          cashRaw,
          feesRaw,
          notesRaw,
          descriptionRaw
        );
        if (hint) currencyRaw = hint;
      }
    }

    if (formatId === "coinbase") {
      // Asset column is crypto ticker; Spot Price Currency is fiat
      if (tickerRaw && FIAT.has(tickerRaw.toUpperCase()) && !currencyRaw) {
        currencyRaw = tickerRaw;
        tickerRaw = "";
      }
      // Advanced trade product "BTC-EUR"
      if (tickerRaw && tickerRaw.includes("-")) {
        const [base, quote] = tickerRaw.split("-");
        tickerRaw = base;
        if (!currencyRaw && quote) currencyRaw = quote;
      }
      if (descriptionRaw || notesRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw || notesRaw);
        if (!tickerRaw && inferred.ticker) tickerRaw = inferred.ticker;
        if (!sideRaw && inferred.side) sideRaw = inferred.side;
      }
      // Receive/Send without qty in some exports
      if (/^receive$/i.test(typeRaw)) typeRaw = "receive";
      if (/^send$/i.test(typeRaw)) typeRaw = "send";
      if (/reward|learning/i.test(typeRaw)) typeRaw = "rewards";
    }

    const date = parseDate(dateRaw);
    if (!date) errors.push("Date invalide ou manquante");

    let type = mapTxType(typeRaw, sideRaw || null);
    // Infer type from free text
    if (!type && nameRaw) type = mapTxType(nameRaw, null);
    if (!type && notesRaw) type = mapTxType(notesRaw, null);
    if (!type && descriptionRaw) type = mapTxType(descriptionRaw, sideRaw || null);
    if (!type) errors.push("Type d'opération non reconnu");

    let ticker = normalizeTicker(tickerRaw);
    // Don't use fiat as ticker
    if (ticker && FIAT.has(ticker)) {
      if (!currencyRaw) currencyRaw = ticker;
      ticker = null;
    }

    let name =
      nameRaw.trim() ||
      productRaw.trim() ||
      ticker ||
      (descriptionRaw ? descriptionRaw.slice(0, 80) : null);

    // Crypto formats default to CRYPTO class
    let forcedClass: string | null = classRaw || null;
    if (
      (formatId === "coinbase" || formatId === "binance" || formatId === "revolut") &&
      ticker &&
      !forcedClass
    ) {
      forcedClass = "CRYPTO";
    }

    const qty = parseQtyField(qtyRaw);
    let unitPrice = parseNumber(priceRaw);
    let fees = parseNumber(feesRaw) ?? 0;
    if (feesRaw && fees === 0) {
      const fm = feesRaw.replace(/\s/g, "").match(/^([\d.,]+)/);
      if (fm) fees = parseNumber(fm[1]) ?? 0;
    }

    let cashAmount = parseNumber(cashRaw);
    // Revolut Amount is often signed
    if (cashAmount != null && cashAmount < 0) {
      if (type === "RETRAIT" || type === "FRAIS" || type === "VENTE") {
        cashAmount = Math.abs(cashAmount);
      } else if (type === "ACHAT" || type === "APPORT") {
        cashAmount = Math.abs(cashAmount);
      }
    }

    // Trades without explicit cash
    if (
      type &&
      ["ACHAT", "VENTE"].includes(type) &&
      cashAmount == null &&
      qty != null &&
      unitPrice != null
    ) {
      cashAmount = qty * unitPrice;
    }

    // Infer price from total/qty
    if (
      type &&
      ["ACHAT", "VENTE"].includes(type) &&
      unitPrice == null &&
      qty != null &&
      qty !== 0 &&
      cashAmount != null
    ) {
      unitPrice = Math.abs(cashAmount / qty);
      warnings.push("Prix unitaire déduit du montant total");
    }

    // Staking / rewards en tokens → type REWARD (+qty, coût 0, pas un achat).
    // Prix marché optionnel (affichage FMV) ; INTERET avec qty crypto bascule aussi en REWARD.
    if (
      type === "INTERET" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "REWARD";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
        warnings.push(
          "Valeur marché indicative déduite du montant (staking / reward)"
        );
      }
      unitPrice = unitPrice ?? 0;
      warnings.push(
        "Récompense crypto → Staking / reward (quantité gratuite, hors achat)"
      );
    }

    // REWARD : normaliser qty / FMV optionnelle
    if (type === "REWARD") {
      if (unitPrice == null && cashAmount != null && qty != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
        warnings.push("Valeur marché indicative déduite du montant");
      }
      unitPrice = unitPrice ?? 0;
      // Pas de cash dépensé
      cashAmount = null;
    }

    // Coinbase Receive (dépôt externe de tokens) : sans prix → REWARD gratuit
    if (
      type === "APPORT" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker) &&
      (cashAmount == null || cashAmount === 0)
    ) {
      type = "REWARD";
      unitPrice = unitPrice ?? 0;
      cashAmount = null;
      warnings.push(
        "Réception crypto sans coût → Staking / reward (entrée de quantité gratuite)"
      );
    }

    // Coinbase Send of crypto → VENTE at 0 or RETRAIT
    if (type === "RETRAIT" && ticker && qty != null && qty > 0 && !FIAT.has(ticker)) {
      type = "VENTE";
      unitPrice = unitPrice ?? 0;
      warnings.push("Envoi crypto importé comme vente à prix 0 (sortie de portefeuille)");
    }

    let currency = (currencyRaw || "EUR").trim().toUpperCase() || "EUR";
    if (currency.length > 3) currency = currency.slice(0, 3);
    if (!/^[A-Z]{3}$/.test(currency)) {
      currency = "EUR";
      warnings.push("Devise invalide → EUR");
    }

    const assetClass = guessAssetClass(ticker, name, forcedClass);

    if (type && ["ACHAT", "VENTE"].includes(type)) {
      if (!ticker && !name) errors.push("Ticker ou nom d'actif requis");
      if (qty == null || qty <= 0) errors.push("Quantité positive requise");
      if (unitPrice == null || unitPrice < 0) errors.push("Prix unitaire requis");
    }

    if (type === "REWARD") {
      if (!ticker && !name) errors.push("Ticker ou nom d'actif requis");
      if (qty == null || qty <= 0) errors.push("Quantité positive requise");
      if (unitPrice != null && unitPrice < 0) {
        errors.push("Valeur marché indicative invalide");
      }
    }

    if (
      type &&
      ["APPORT", "RETRAIT", "FRAIS", "INTERET", "DIVIDENDE", "COUPON", "LOYER"].includes(type)
    ) {
      if (cashAmount == null || cashAmount <= 0) {
        if (cashAmount != null && cashAmount < 0) cashAmount = Math.abs(cashAmount);
        else if (qty != null && unitPrice != null) cashAmount = Math.abs(qty * unitPrice);
        else errors.push("Montant cash requis");
      }
      if (!name && ticker) name = ticker;
    }

    // Skip non-portfolio Revolut noise
    if (formatId === "revolut" && /card.?payment|atm|fee.*revolut/i.test(typeRaw + descriptionRaw)) {
      if (type === "RETRAIT" && !ticker) {
        warnings.push("Paiement carte / ATM — hors portefeuille titres (décoché)");
      }
    }

    if (type === "TRANSFERT_CASH" || type === "TRANSFERT_TITRE") {
      warnings.push("Transferts non importés automatiquement (ignorés au commit)");
    }

    // Skip failed / pending Revolut states
    if (/^reverted$|^failed$|^pending$/i.test(notesRaw) || /^reverted$|^failed$/i.test(typeRaw)) {
      errors.push("Opération non finalisée (pending/failed) — ignorée");
    }

    const status: ImportDraftRow["status"] =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";

    const autoDeselect =
      errors.length > 0 ||
      type === "TRANSFERT_CASH" ||
      type === "TRANSFERT_TITRE" ||
      (formatId === "revolut" &&
        type === "RETRAIT" &&
        !ticker &&
        /card|atm/i.test(typeRaw + descriptionRaw));

    rows.push({
      line,
      selected: !autoDeselect,
      status,
      errors,
      warnings,
      type,
      occurredAt: date ? toIsoLocal(date) : null,
      ticker,
      name,
      quantity: qty != null ? String(qty) : null,
      unitPrice: unitPrice != null ? String(unitPrice) : null,
      fees: String(fees),
      currency,
      cashAmount: cashAmount != null ? String(Math.abs(cashAmount)) : null,
      notes: [notesRaw, descriptionRaw, productRaw].filter(Boolean).join(" · ") || null,
      assetClass,
      raw,
    });
  });

  return { rows, columnMap, formatLabel };
}
