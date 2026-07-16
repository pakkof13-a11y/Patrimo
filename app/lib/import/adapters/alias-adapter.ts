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
