/**
 * Point d'entrée public import_csv — audit / restructuration modulaire.
 *
 * Pipeline :
 * 1. parseCsv (délimiteur, quotes, BOM)
 * 2. detectBestAdapter (Strategy Pattern)
 * 3. adapter.parse → TransactionImport[]
 * 4. (optionnel) mapCsvToDrafts pour le commit UI existant
 */

import { parseCsv, type ParsedCsv } from "./csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "./map-rows";
import { detectBestAdapter, getAdapter, listAdapters } from "./adapters/registry";
import type {
  ColumnMapping,
  PlatformAdapterId,
  TransactionImport,
  MappingConfidence,
} from "./types";
import type { ImportFormatId } from "./presets";
import { detectFormatFromHeaders, getFormat } from "./presets";
import {
  expandIbkrActivityStatement,
  isIbkrActivityStatement,
} from "./ibkr-activity";
import { expandParadexFills, isParadexFillsExport } from "./paradex-fills";
import {
  expandHyperliquidTrade,
  expandHyperliquidFunding,
  isHyperliquidTradeExport,
  isHyperliquidFundingExport,
} from "./hyperliquid-fills";

export type ImportCsvOptions = {
  /** Forcer un adaptateur / format */
  formatId?: PlatformAdapterId | ImportFormatId | "auto";
  delimiter?: string;
  /** Mapping colonnes manuel ou mémorisé */
  columnMap?: ColumnMapping;
  /** IBKR multi-comptes : ne conserver que ces comptes (sinon tous) */
  ibkrAccountIds?: string[];
};

export type ImportCsvResult = {
  csv: ParsedCsv;
  formatId: string;
  formatLabel: string;
  detectedFormatId: string | null;
  columnMap: ColumnMapping;
  confidence: MappingConfidence;
  needsManualMapping: boolean;
  /**
   * Auto-détection ambiguë : plusieurs formats score proche.
   * L’UI doit demander à l’utilisateur de choisir le template.
   */
  needsFormatConfirm?: boolean;
  ambiguousFormats?: Array<{ id: string; score: number; label: string }>;
  transactions: TransactionImport[];
  /** Drafts pour le pipeline de commit existant */
  drafts: ImportDraftRow[];
  warnings: string[];
  adapterRanking: Array<{ id: string; score: number; label: string }>;
  /** IBKR multi-comptes : comptes distincts détectés dans le relevé */
  ibkrAccounts?: string[];
};

/**
 * Fonction principale d'import CSV (contrat legacy + adaptateurs).
 */
export function importCsv(
  csvText: string,
  options: ImportCsvOptions = {}
): ImportCsvResult {
  // ── IBKR Activity Statement (multi-sections) ─────────────────────────────
  // Doit être traité avant parseCsv classique (headers ≠ 1ère ligne).
  const forceIbkr =
    options.formatId === "interactive_brokers" ||
    options.formatId === "auto" ||
    !options.formatId;
  if (forceIbkr && isIbkrActivityStatement(csvText)) {
    const expanded = expandIbkrActivityStatement(csvText, {
      accountIds: options.ibkrAccountIds,
    });
    if (expanded.matched && expanded.csv.rows.length > 0) {
      const draftResult = mapCsvToDrafts(expanded.csv, "interactive_brokers");
      const okCount = draftResult.rows.filter((r) => r.status === "ok").length;
      return {
        csv: expanded.csv,
        formatId: "interactive_brokers",
        formatLabel: getFormat("interactive_brokers").label,
        detectedFormatId: "interactive_brokers",
        columnMap: draftResult.columnMap as ColumnMapping,
        confidence:
          okCount > 0 ? (okCount >= draftResult.rows.length * 0.7 ? "high" : "medium") : "low",
        needsManualMapping: false,
        needsFormatConfirm: false,
        transactions: [],
        drafts: draftResult.rows,
        warnings: expanded.warnings,
        adapterRanking: [
          {
            id: "interactive_brokers",
            score: 99,
            label: getFormat("interactive_brokers").label,
          },
        ],
        ibkrAccounts: expanded.accounts,
      };
    }
    if (expanded.matched && expanded.csv.rows.length === 0) {
      // Statement détecté mais vide → message clair
      return {
        csv: expanded.csv,
        formatId: "interactive_brokers",
        formatLabel: getFormat("interactive_brokers").label,
        detectedFormatId: "interactive_brokers",
        columnMap: {},
        confidence: "none",
        needsManualMapping: true,
        transactions: [],
        drafts: [],
        warnings: expanded.warnings.length
          ? expanded.warnings
          : ["Activity Statement IBKR sans lignes de transactions"],
        adapterRanking: [],
        ibkrAccounts: expanded.accounts,
      };
    }
  }

  const csv = parseCsv(csvText, options.delimiter);

  // ── Formats plats nécessitant un pré-aplatissement avant le pipeline
  // alias→ColumnRole générique (extraction market/dir/payment-sign) ─────────
  // Ordre de priorité : Paradex > Hyperliquid Funding > Hyperliquid Trades.
  const forceFlatExpand =
    options.formatId === "auto" || !options.formatId;
  if (
    (forceFlatExpand || options.formatId === "paradex") &&
    isParadexFillsExport(csv.headers)
  ) {
    const expanded = expandParadexFills(csv.headers, csv.rows);
    if (expanded.matched) {
      const draftResult = mapCsvToDrafts(expanded.csv, "paradex");
      const okCount = draftResult.rows.filter((r) => r.status === "ok").length;
      return {
        csv: expanded.csv,
        formatId: "paradex",
        formatLabel: getFormat("paradex").label,
        detectedFormatId: "paradex",
        columnMap: draftResult.columnMap as ColumnMapping,
        confidence:
          okCount > 0
            ? okCount >= draftResult.rows.length * 0.7
              ? "high"
              : "medium"
            : "low",
        needsManualMapping: false,
        transactions: [],
        drafts: draftResult.rows,
        warnings: expanded.warnings,
        adapterRanking: [{ id: "paradex", score: 97, label: getFormat("paradex").label }],
      };
    }
  }
  if (
    (forceFlatExpand || options.formatId === "hyperliquid_funding") &&
    isHyperliquidFundingExport(csv.headers)
  ) {
    const expanded = expandHyperliquidFunding(csv.headers, csv.rows);
    if (expanded.matched) {
      const draftResult = mapCsvToDrafts(expanded.csv, "hyperliquid_funding");
      const okCount = draftResult.rows.filter((r) => r.status === "ok").length;
      return {
        csv: expanded.csv,
        formatId: "hyperliquid_funding",
        formatLabel: getFormat("hyperliquid_funding").label,
        detectedFormatId: "hyperliquid_funding",
        columnMap: draftResult.columnMap as ColumnMapping,
        confidence:
          okCount > 0
            ? okCount >= draftResult.rows.length * 0.7
              ? "high"
              : "medium"
            : "low",
        needsManualMapping: false,
        transactions: [],
        drafts: draftResult.rows,
        warnings: expanded.warnings,
        adapterRanking: [
          { id: "hyperliquid_funding", score: 96, label: getFormat("hyperliquid_funding").label },
        ],
      };
    }
  }
  if (
    (forceFlatExpand || options.formatId === "hyperliquid_trade") &&
    isHyperliquidTradeExport(csv.headers)
  ) {
    const expanded = expandHyperliquidTrade(csv.headers, csv.rows);
    if (expanded.matched) {
      const draftResult = mapCsvToDrafts(expanded.csv, "hyperliquid_trade");
      const okCount = draftResult.rows.filter((r) => r.status === "ok").length;
      return {
        csv: expanded.csv,
        formatId: "hyperliquid_trade",
        formatLabel: getFormat("hyperliquid_trade").label,
        detectedFormatId: "hyperliquid_trade",
        columnMap: draftResult.columnMap as ColumnMapping,
        confidence:
          okCount > 0
            ? okCount >= draftResult.rows.length * 0.7
              ? "high"
              : "medium"
            : "low",
        needsManualMapping: false,
        transactions: [],
        drafts: draftResult.rows,
        warnings: expanded.warnings,
        adapterRanking: [
          { id: "hyperliquid_trade", score: 95, label: getFormat("hyperliquid_trade").label },
        ],
      };
    }
  }

  if (csv.headers.length === 0) {
    return {
      csv,
      formatId: "dynamic",
      formatLabel: "—",
      detectedFormatId: null,
      columnMap: {},
      confidence: "none",
      needsManualMapping: true,
      transactions: [],
      drafts: [],
      warnings: ["Aucune colonne détectée"],
      adapterRanking: [],
    };
  }

  let formatId = options.formatId || "auto";
  let detected: string | null = null;
  let ranking: Array<{ id: string; score: number; label: string }> = [];

  let needsFormatConfirm = false;
  let ambiguousFormats:
    | Array<{ id: string; score: number; label: string }>
    | undefined;

  if (formatId === "auto" || formatId === "generic" || formatId === "dynamic") {
    const best = detectBestAdapter(csv.headers);
    ranking = best.ranking;
    detected = best.adapter.meta.id;
    if (best.ambiguous && best.ambiguous.length > 1) {
      needsFormatConfirm = true;
      ambiguousFormats = best.ambiguous;
    }
    if (formatId === "auto") {
      // En cas d’ambiguïté, on garde le meilleur score mais l’UI doit confirmer
      formatId = best.adapter.meta.id as typeof formatId;
    } else if (formatId === "generic") {
      detected = detectFormatFromHeaders(csv.headers);
    }
  } else {
    detected = detectFormatFromHeaders(csv.headers);
  }

  const adapter = getAdapter(formatId);
  const parsed = adapter.parse({
    headers: csv.headers,
    rows: csv.rows,
    columnMap: options.columnMap,
  });

  // Drafts (validation UI + commit) :
  // - formats connus (revolut, patrimo…) : mapping preset natif + override manuel user only
  // - dynamic/generic : mapping adaptateur (auto-match)
  // Ne pas forcer parsed.columnMap en override pour les presets : un merge dyn/alias
  // partiel peut casser le preset (ex. Value manquante → 1000+ erreurs).
  const draftFormat =
    formatId === "dynamic"
      ? "generic"
      : (formatId as ImportFormatId);

  const knownPreset =
    draftFormat !== "generic" &&
    draftFormat !== "dynamic" &&
    String(formatId) !== "dynamic";

  let drafts: ImportDraftRow[] = [];
  try {
    const mapped = mapCsvToDrafts(csv, draftFormat as ImportFormatId, {
      columnMapOverride: knownPreset
        ? options.columnMap || null
        : parsed.columnMap || options.columnMap || null,
    });
    drafts = mapped.rows;
  } catch {
    drafts = [];
  }

  // Si le mapping adaptateur est meilleur (moins d’erreurs), l’utiliser pour l’UI
  // (cas dynamic / generic surtout).
  if (knownPreset && options.columnMap) {
    // user override already applied
  } else if (!knownPreset) {
    // already used adapter map
  }

  const columnMapForUi =
    knownPreset && !options.columnMap
      ? // align UI map with what drafts used (preset resolve)
        (() => {
          try {
            return mapCsvToDrafts(csv, draftFormat as ImportFormatId).columnMap;
          } catch {
            return parsed.columnMap;
          }
        })()
      : parsed.columnMap;

  return {
    csv,
    formatId: String(formatId),
    formatLabel: adapter.meta.label,
    detectedFormatId: detected,
    columnMap: columnMapForUi as ColumnMapping,
    confidence: parsed.confidence,
    needsManualMapping: parsed.needsManualMapping || needsFormatConfirm,
    needsFormatConfirm,
    ambiguousFormats,
    transactions: parsed.transactions,
    drafts,
    warnings: parsed.warnings,
    adapterRanking: ranking,
  };
}

export { listAdapters, getAdapter, detectBestAdapter };
export type { TransactionImport, ColumnMapping };
