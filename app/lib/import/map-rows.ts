import type { ParsedCsv } from "./csv-parse";
import { normalizeHeader } from "./csv-parse";
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
  /** Nom plateforme détecté dans le CSV (sinon destination import). */
  platformName: string | null;
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
    let notesRaw = getByRole(raw, columnMap, "notes");
    const classRaw = getByRole(raw, columnMap, "assetClass");
    const descriptionRaw = getByRole(raw, columnMap, "description");
    const productRaw = getByRole(raw, columnMap, "product");
    const platformRaw = getByRole(raw, columnMap, "platform");

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

    // ── Ledger Live (hardware wallet export) ────────────────────────────────
    if (formatId === "ledger_live") {
      const statusRaw = (() => {
        for (const [k, v] of Object.entries(raw)) {
          if (normalizeHeader(k) === "status") return v;
        }
        return "";
      })();
      if (/^failed$/i.test(statusRaw.trim())) {
        // Avertissement (pas error) : ligne désélectionnée, ne bloque pas l’import
        warnings.push("Opération Failed (Ledger) — ignorée");
      }
      const tOp = typeRaw.trim();
      if (/^fees$/i.test(tOp)) typeRaw = "fees";
      else if (/^in$/i.test(tOp)) typeRaw = "in";
      else if (/^out$/i.test(tOp)) typeRaw = "out";
      else if (/^reward$/i.test(tOp)) typeRaw = "reward";
      // Staking / bonding → TRANSFERT_TITRE (désélection auto, hors positions libres)
      else if (
        /^(delegate|undelegate|redelegate|bond|unbond|opt_in|opt_out|lock|chill|nominate|withdraw_unbonded)$/i.test(
          tOp
        )
      ) {
        typeRaw = "delegate";
      }
    }

    if (formatId === "coinbase") {
      // Asset column is crypto ticker; Spot/Price Currency is fiat
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
      if (/reward|learning|staking\s*income|inflation/i.test(typeRaw)) {
        typeRaw = "rewards";
      }
      // Prix avec préfixe $ déjà géré par parseNumber ; s’assurer que
      // Price Currency (USD) n’écrase pas un ticker crypto
      if (currencyRaw && !FIAT.has(currencyRaw.toUpperCase()) && tickerRaw) {
        // garder currency fiat si dispo dans raw
        for (const [k, v] of Object.entries(raw)) {
          if (/price\s*currency|spot\s*price\s*currency/i.test(k) && v) {
            currencyRaw = v.replace(/[^A-Za-z]/g, "").slice(0, 3);
            break;
          }
        }
      }
    }

    // Crypto.com App (wallet / carte / fiat)
    if (formatId === "cryptocom") {
      // Conversions : Currency (sold) + To Currency (bought) → enregistrer l’achat
      if (
        /crypto_exchange|viban_purchase|crypto_viban/i.test(typeRaw) &&
        nameRaw
      ) {
        tickerRaw = nameRaw; // To Currency
        // To Amount was mapped to cashAmount role — use as quantity
        if (cashRaw && (!qtyRaw || Number(String(qtyRaw).replace(",", ".")) < 0)) {
          // quantity stays from Amount (sold, often negative) — use abs To Amount if present
        }
        sideRaw = "buy";
      }
      // Quantity signed : abs pour ACHAT/VENTE
      // native_amount was mapped poorly to notes — recover from raw keys
      if (!currencyRaw) {
        for (const [k, v] of Object.entries(raw)) {
          if (/native.?currency/i.test(k) && v) {
            currencyRaw = v;
            break;
          }
        }
      }
      // Prefer Transaction Kind already in typeRaw
      if (!typeRaw && descriptionRaw) {
        typeRaw = descriptionRaw;
      }
      // Card cashbacks / rewards
      if (/cashback|referral|supercharger|mco_stake/i.test(typeRaw + descriptionRaw)) {
        typeRaw = "reward";
      }
    }

    // Crypto.com Deposit / Withdrawal exports
    if (formatId === "cryptocom_transfer") {
      const rawKeys = Object.keys(raw).join(" ");
      if (/deposit/i.test(rawKeys) && !/withdrawal/i.test(rawKeys)) {
        typeRaw = "deposit";
      } else if (/withdrawal/i.test(rawKeys)) {
        typeRaw = "withdraw";
      } else if (/supercharger|reward/i.test(rawKeys + typeRaw)) {
        typeRaw = "reward";
      }
      // Supercharger rewards: Time, Coin, Amount only
      if (!typeRaw) typeRaw = "reward";
    }

    // Nexo
    if (formatId === "nexo") {
      // Interest / rewards stay on Input Currency
      if (/interest|dividend|bonus|cashback/i.test(typeRaw)) {
        // keep ticker from input currency
      }
      if (/withdrawal/i.test(typeRaw)) typeRaw = "withdraw";
      if (/deposit/i.test(typeRaw)) typeRaw = "deposit";
      // Exchange / convert → buy of output
      if (/exchange/i.test(typeRaw) && nameRaw) {
        tickerRaw = nameRaw;
        // output amount in cashAmount role
        sideRaw = "buy";
        typeRaw = "buy";
      }
      if (/locking|transfer from savings/i.test(typeRaw + descriptionRaw)) {
        typeRaw = "transfer";
      }
    }

    // AscendEX staking / DeFi
    if (formatId === "ascendex") {
      if (/reward|compound|interest|award/i.test(typeRaw + notesRaw + descriptionRaw)) {
        typeRaw = "reward";
      }
      if (/deposit/i.test(typeRaw + notesRaw)) typeRaw = "deposit";
      if (/redemption|withdraw/i.test(typeRaw + notesRaw)) typeRaw = "withdraw";
      // Reward cell "0.84 CAPS-S"
      if (qtyRaw && /[A-Za-z]/.test(qtyRaw)) {
        const m = qtyRaw.replace(/\s/g, "").match(/^([\d.,]+)/);
        if (m) {
          // quantity cleaned below via parseQtyField
          (raw as Record<string, string>).__ascendex_qty = m[1]!;
        }
      }
    }

    // Override qty from AscendEX reward parse
    const qtyField =
      formatId === "ascendex" && (raw as Record<string, string>).__ascendex_qty
        ? (raw as Record<string, string>).__ascendex_qty
        : qtyRaw;

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

    // Crypto formats default to CRYPTO class — pas les exports Invest (Price per share)
    let forcedClass: string | null = classRaw || null;
    const rawKeys = Object.keys(raw);
    const isRevolutEquityExport = rawKeys.some((k) =>
      /price\s*per\s*share|total\s*amount/i.test(k)
    );
    if (
      (formatId === "coinbase" ||
        formatId === "binance" ||
        formatId === "cryptocom" ||
        formatId === "cryptocom_transfer" ||
        formatId === "nexo" ||
        formatId === "ascendex" ||
        formatId === "ledger_live" ||
        (formatId === "revolut" && !isRevolutEquityExport)) &&
      ticker &&
      !forcedClass
    ) {
      forcedClass = "CRYPTO";
    }
    if (formatId === "revolut" && isRevolutEquityExport && ticker && !forcedClass) {
      forcedClass = "ACTIONS";
    }

    let qty = parseQtyField(qtyField || qtyRaw);
    // Crypto.com / Nexo : quantités signées
    if (qty != null && qty < 0) qty = Math.abs(qty);
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

    // Ledger Live : frais réseau en crypto (qty = fees) → VENTE de qty
    if (
      formatId === "ledger_live" &&
      type === "FRAIS" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "VENTE";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
      }
      unitPrice = unitPrice ?? 0;
      fees = 0;
      cashAmount = null;
      // pas de warning bulk (sinon 800+ lignes « avertissement » en UI)
    }

    // Ledger Live : opérations contractuelles à qty 0 (approve, claim vide…)
    // → désélection + warning (pas error, pour ne pas afficher « 194 erreurs »)
    let ledgerSkipNoQty = false;
    if (
      formatId === "ledger_live" &&
      (qty == null || qty === 0) &&
      type &&
      ["APPORT", "RETRAIT", "FRAIS", "REWARD", "ACHAT", "VENTE"].includes(type)
    ) {
      warnings.push("Sans mouvement de quantité — ignorée");
      ledgerSkipNoQty = true;
      type = null; // évite les validations cash/qty en aval
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
      if (formatId !== "ledger_live") {
        warnings.push("Prix unitaire déduit du montant total");
      }
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
        if (formatId !== "ledger_live") {
          warnings.push("Valeur marché indicative déduite du montant");
        }
      }
      unitPrice = unitPrice ?? 0;
      // Pas de cash dépensé
      cashAmount = null;
    }

    // Réception crypto (Revolut « Réception », Ledger « IN », Receive…) :
    // ce n'est PAS un apport cash — entrée de quantité en REWARD (coût 0).
    // FMV (Price/Value) = info d’affichage uniquement, pas un ACHAT.
    // ACHAT uniquement si le type source est clairement un achat/purchase.
    if (
      type === "APPORT" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      const hay = `${typeRaw} ${notesRaw} ${descriptionRaw} ${nameRaw}`;
      const buyHint =
        /^(buy|achat|purchase)$/i.test((typeRaw || "").trim()) ||
        /crypto_purchase|viban_purchase|bought|acquisition/i.test(hay);
      if (buyHint) {
        type = "ACHAT";
        if (unitPrice == null && cashAmount != null && qty !== 0) {
          unitPrice = Math.abs(cashAmount / qty);
        }
        unitPrice = unitPrice ?? 0;
        cashAmount = null;
        warnings.push("Dépôt crypto type achat → Achat (entrée de position)");
      } else {
        type = "REWARD";
        if (unitPrice == null && cashAmount != null && qty !== 0) {
          unitPrice = Math.abs(cashAmount / qty);
          if (formatId !== "ledger_live") {
            warnings.push(
              "Valeur marché indicative déduite du montant (réception)"
            );
          }
        }
        unitPrice = unitPrice ?? 0;
        cashAmount = null;
        if (formatId !== "ledger_live") {
          warnings.push(
            "Réception crypto → Staking / reward (entrée de quantité, hors apport cash)"
          );
        }
      }
    }

    // Retrait crypto (envoi) → VENTE ledger (baisse stock) ; note retrait-crypto (UX).
    if (
      type === "RETRAIT" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "VENTE";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
      }
      unitPrice = unitPrice ?? 0;
      cashAmount = null;
      notesRaw = notesRaw
        ? `${notesRaw} | retrait-crypto`
        : "retrait-crypto (sortie de portefeuille)";
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
      // Ledger staking ops : un seul message court, pas de flood
      if (formatId === "ledger_live") {
        warnings.push("Staking / bonding — non importé (hors positions libres)");
      } else {
        warnings.push(
          "Transferts non importés automatiquement (ignorés au commit)"
        );
      }
    }

    // Skip failed / pending Revolut states
    if (/^reverted$|^failed$|^pending$/i.test(notesRaw) || /^reverted$|^failed$/i.test(typeRaw)) {
      errors.push("Opération non finalisée (pending/failed) — ignorée");
    }

    // Ne pas marquer Failed générique si déjà géré Ledger
    if (
      formatId === "ledger_live" &&
      warnings.some((w) => /Failed \(Ledger\)/i.test(w))
    ) {
      const idx = errors.findIndex((e) =>
        /non finalisée \(pending\/failed\)/i.test(e)
      );
      if (idx >= 0) errors.splice(idx, 1);
    }

    const ledgerFailed = warnings.some((w) => /Failed \(Ledger\)/i.test(w));

    const status: ImportDraftRow["status"] =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";

    const autoDeselect =
      errors.length > 0 ||
      type === "TRANSFERT_CASH" ||
      type === "TRANSFERT_TITRE" ||
      type == null ||
      ledgerSkipNoQty ||
      ledgerFailed ||
      (formatId === "revolut" &&
        type === "RETRAIT" &&
        !ticker &&
        /card|atm/i.test(typeRaw + descriptionRaw));

    const platformName = platformRaw?.trim() ? platformRaw.trim() : null;

    // Ledger : nom d’actif = ticker ; plateforme = Account Name (Solana, Arbitrum…)
    // Notes = hash + account pour dédup / audit
    const notesParts =
      formatId === "ledger_live"
        ? [
            notesRaw,
            platformName ? `account:${platformName}` : "",
            descriptionRaw,
            productRaw,
          ]
        : [notesRaw, descriptionRaw, productRaw];

    rows.push({
      line,
      selected: !autoDeselect,
      status,
      errors,
      warnings,
      type,
      occurredAt: date ? toIsoLocal(date) : null,
      ticker,
      name: name || ticker,
      quantity: qty != null ? String(qty) : null,
      unitPrice: unitPrice != null ? String(unitPrice) : null,
      fees: String(fees),
      currency,
      cashAmount: cashAmount != null ? String(Math.abs(cashAmount)) : null,
      notes: notesParts.filter(Boolean).join(" · ") || null,
      // Une seule plateforme d’import « Ledger Live » recommandée ;
      // Account Name reste en notes. Si l’utilisateur veut scinder par chaîne,
      // le champ platform du CSV peut être mappé manuellement.
      platformName:
        formatId === "ledger_live"
          ? platformName
            ? `Ledger · ${platformName}`
            : "Ledger Live"
          : platformName,
      assetClass,
      raw,
    });
  });

  return { rows, columnMap, formatLabel };
}
