/**
 * Adaptateur générique basé sur un preset d'alias (Strategy Pattern).
 * Couvre les plateformes déclarées dans presets.ts + nouveaux IDs.
 */

import { normalizeHeader } from "../csv-parse";
import { autoMatchHeaders, mergeColumnMaps, mappingNeedsUserInput } from "../dynamic-mapper";
import type {
  AdapterParseInput,
  AdapterParseResult,
  ColumnMapping,
  ColumnRole,
  PlatformAdapterId,
  PlatformCsvAdapter,
  PlatformAdapterMeta,
  TransactionImport,
} from "../types";
import { rowToTransactionImport } from "./row-utils";

export type AliasPreset = {
  id: PlatformAdapterId;
  label: string;
  description: string;
  /** header normalisé → rôle */
  aliases: Record<string, ColumnRole>;
  /** signatures d'en-têtes pour detect() */
  detectHints?: string[];
};

function resolveMapFromAliases(
  headers: string[],
  aliases: Record<string, ColumnRole>
): ColumnMapping {
  const map: ColumnMapping = {};
  for (const h of headers) {
    const key = normalizeHeader(h);
    const role = aliases[key];
    if (role) map[h] = role;
  }
  return map;
}

export function createAliasAdapter(preset: AliasPreset): PlatformCsvAdapter {
  const meta: PlatformAdapterMeta = {
    id: preset.id,
    label: preset.label,
    description: preset.description,
  };

  return {
    meta,
    detect(headers: string[]): number {
      const keys = headers.map((h) => normalizeHeader(h));
      const hints = preset.detectHints || Object.keys(preset.aliases).slice(0, 8);
      let hits = 0;
      for (const hint of hints) {
        if (keys.some((k) => k === hint || k.includes(hint))) hits++;
      }
      // Bonus fort : exports Revolut (crypto FR ou Invest stocks)
      if (preset.id === "revolut") {
        const hasSymbol = keys.includes("symbol");
        const hasValue = keys.includes("value");
        const hasType = keys.includes("type");
        const hasDate = keys.includes("date");
        const hasQty = keys.includes("quantity");
        const hasTicker = keys.includes("ticker");
        const hasPricePerShare = keys.some(
          (k) => k === "price_per_share" || k.includes("price_per_share")
        );
        const hasTotalAmount = keys.some(
          (k) => k === "total_amount" || k.includes("total_amount")
        );
        // Export Invest : Date, Ticker, Type, Quantity, Price per share, Total Amount
        if (hasDate && hasTicker && hasType && hasPricePerShare) {
          return hasTotalAmount ? 96 : 93;
        }
        if (hasSymbol && hasType && hasDate && hasQty && hasValue) {
          return 92;
        }
        if (hasSymbol && hasType && hasDate && hasQty) {
          return 78;
        }
      }
      // Crypto.com App
      if (preset.id === "cryptocom") {
        const hasKind = keys.some((k) => k === "transaction_kind");
        const hasTs = keys.some(
          (k) => k === "timestamp_utc" || k === "timestamp"
        );
        const hasNative = keys.some((k) => k.includes("native_amount"));
        const hasDesc = keys.some(
          (k) =>
            k === "transaction_description" || k === "description"
        );
        if (hasKind && hasTs && hasNative) return 97;
        if (hasKind && hasTs) return 92;
        if (hasTs && hasNative && hasDesc && keys.includes("currency"))
          return 88;
      }
      // Crypto.com Deposit/Withdrawal
      if (preset.id === "cryptocom_transfer") {
        const hasCoin = keys.includes("coin");
        const hasDep = keys.some((k) => k.includes("deposit_amount"));
        const hasWd = keys.some((k) => k.includes("withdrawal_amount"));
        const hasTime = keys.some((k) => k.includes("time"));
        if (hasCoin && hasTime && (hasDep || hasWd)) return 96;
        if (hasCoin && (hasDep || hasWd)) return 85;
      }
      // Nexo
      if (preset.id === "nexo") {
        const hasTxId = keys.includes("transaction");
        const hasDateTime = keys.some(
          (k) => k === "date_time" || k === "date_time_utc"
        );
        const hasInput = keys.some((k) => k.includes("input_currency"));
        const hasType = keys.includes("type");
        if (hasTxId && hasType && hasDateTime) return 96;
        if (hasTxId && hasType && hasInput) return 93;
        if (hasTxId && hasType && keys.includes("currency")) return 90;
      }
      // AscendEX
      if (preset.id === "ascendex") {
        const hasToken = keys.includes("token");
        const hasProjects = keys.includes("projects");
        if (hasToken && hasProjects && keys.includes("time")) return 94;
        if (hasToken && keys.includes("farming_balance")) return 90;
      }
      // Ledger Live operations export
      if (preset.id === "ledger_live") {
        const hasOpDate = keys.some(
          (k) => k === "operation_date" || k.includes("operation_date")
        );
        const hasOpType = keys.some(
          (k) => k === "operation_type" || k.includes("operation_type")
        );
        const hasTicker = keys.some(
          (k) => k === "currency_ticker" || k.includes("currency_ticker")
        );
        const hasAmt = keys.some(
          (k) =>
            k === "operation_amount" || k.includes("operation_amount")
        );
        const hasAccount = keys.some(
          (k) => k === "account_name" || k.includes("account_name")
        );
        const hasHash = keys.some(
          (k) => k === "operation_hash" || k.includes("operation_hash")
        );
        if (hasOpDate && hasOpType && hasTicker && hasAmt) {
          return hasAccount || hasHash ? 98 : 95;
        }
        if (hasOpType && hasTicker && hasAmt) return 90;
      }
      // Coinbase — signatures fortes (éviter collision Crypto.com)
      if (preset.id === "coinbase") {
        const hasQtyTx = keys.some((k) => k.includes("quantity_transacted"));
        const hasSpot = keys.some((k) => k.includes("spot_price_at_transaction"));
        // Nouveau format 2024–2026 : Price at Transaction + Price Currency + ID
        const hasPriceAt = keys.some(
          (k) => k === "price_at_transaction" || k.includes("price_at_transaction")
        );
        const hasTxType = keys.includes("transaction_type");
        const hasAsset = keys.includes("asset");
        if (hasQtyTx && (hasSpot || hasPriceAt) && hasTxType) return 97;
        if (hasQtyTx || hasSpot) return 95;
        if (hasPriceAt && hasTxType && hasAsset) return 96;
        if (hasTxType && hasAsset) return 88;
      }
      // Modèle Patrimo exporté (date;type;ticker;unit_price;…)
      // Ne pas voler les exports broker (Price per share / Total Amount / FX Rate)
      if (preset.id === "patrimo") {
        const looksBroker =
          keys.some((k) => k.includes("price_per_share")) ||
          keys.some((k) => k === "fx_rate" || k.includes("fx_rate")) ||
          keys.some((k) => k === "total_amount");
        if (looksBroker) return 0;
        if (
          keys.includes("date") &&
          keys.includes("type") &&
          keys.includes("ticker") &&
          (keys.includes("unit_price") || keys.includes("quantity"))
        ) {
          return 88;
        }
      }
      if (hits === 0) return 0;
      // Score proportionnel
      return Math.min(100, Math.round((hits / Math.max(hints.length, 1)) * 100));
    },
    parse(input: AdapterParseInput): AdapterParseResult {
      const auto = resolveMapFromAliases(input.headers, preset.aliases);
      // Compléter avec dynamic si partiel
      const dyn = autoMatchHeaders(input.headers);
      const base = mergeColumnMaps(dyn.columnMap, auto);
      const columnMap = mergeColumnMaps(base, input.columnMap);

      const match = autoMatchHeaders(input.headers);
      // recompute missing with final map
      const roles = new Set(Object.values(columnMap));
      const missing: ColumnRole[] = [];
      if (![...roles].includes("date")) missing.push("date");
      if (!roles.has("type") && !roles.has("side")) missing.push("type");
      if (!roles.has("ticker") && !roles.has("name")) missing.push("ticker");
      if (!roles.has("quantity")) missing.push("quantity");
      if (!roles.has("unitPrice") && !roles.has("cashAmount")) missing.push("unitPrice");

      const confidence =
        missing.length === 0
          ? "high"
          : missing.length <= 1
            ? "medium"
            : match.confidence;

      const transactions: TransactionImport[] = [];
      const warnings: string[] = [];
      input.rows.forEach((row, idx) => {
        const { tx, errors, warnings: w } = rowToTransactionImport(
          row,
          columnMap,
          idx + 2
        );
        warnings.push(...w.map((x) => `L${idx + 2}: ${x}`));
        if (tx && errors.length === 0 && tx.type !== "OTHER") {
          transactions.push(tx);
        } else if (errors.length) {
          warnings.push(`L${idx + 2}: ${errors.join(", ")}`);
        }
      });

      return {
        transactions,
        columnMap,
        warnings,
        needsManualMapping:
          mappingNeedsUserInput({
            columnMap,
            missingRoles: missing,
            confidence,
            score: match.score,
            matchedRoles: [...roles],
          }) && !input.columnMap,
        confidence,
      };
    },
  };
}
