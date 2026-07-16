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
import { detectFormatFromHeaders } from "./presets";

export type ImportCsvOptions = {
  /** Forcer un adaptateur / format */
  formatId?: PlatformAdapterId | ImportFormatId | "auto";
  delimiter?: string;
  /** Mapping colonnes manuel ou mémorisé */
  columnMap?: ColumnMapping;
};

export type ImportCsvResult = {
  csv: ParsedCsv;
  formatId: string;
  formatLabel: string;
  detectedFormatId: string | null;
  columnMap: ColumnMapping;
  confidence: MappingConfidence;
  needsManualMapping: boolean;
  transactions: TransactionImport[];
  /** Drafts pour le pipeline de commit existant */
  drafts: ImportDraftRow[];
  warnings: string[];
  adapterRanking: Array<{ id: string; score: number; label: string }>;
};

/**
 * Fonction principale d'import CSV (contrat legacy + adaptateurs).
 */
export function importCsv(
  csvText: string,
  options: ImportCsvOptions = {}
): ImportCsvResult {
  const csv = parseCsv(csvText, options.delimiter);
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

  if (formatId === "auto" || formatId === "generic" || formatId === "dynamic") {
    const best = detectBestAdapter(csv.headers);
    ranking = best.ranking;
    detected = best.adapter.meta.id;
    if (formatId === "auto") {
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

  // Drafts via le moteur existant (compat commit) avec le même mapping
  const draftFormat =
    formatId === "dynamic"
      ? "generic"
      : (formatId as ImportFormatId);

  let drafts: ImportDraftRow[] = [];
  try {
    const mapped = mapCsvToDrafts(csv, draftFormat as ImportFormatId, {
      columnMapOverride: parsed.columnMap,
    });
    drafts = mapped.rows;
  } catch {
    drafts = [];
  }

  return {
    csv,
    formatId: String(formatId),
    formatLabel: adapter.meta.label,
    detectedFormatId: detected,
    columnMap: parsed.columnMap,
    confidence: parsed.confidence,
    needsManualMapping: parsed.needsManualMapping,
    transactions: parsed.transactions,
    drafts,
    warnings: parsed.warnings,
    adapterRanking: ranking,
  };
}

export { listAdapters, getAdapter, detectBestAdapter };
export type { TransactionImport, ColumnMapping };
