/**
 * Fallback intelligent : auto-matching headers + mapping manuel optionnel.
 */

import {
  autoMatchHeaders,
  mergeColumnMaps,
  mappingNeedsUserInput,
} from "../dynamic-mapper";
import type {
  AdapterParseInput,
  AdapterParseResult,
  PlatformCsvAdapter,
  TransactionImport,
} from "../types";
import { rowToTransactionImport } from "./row-utils";

export const dynamicAdapter: PlatformCsvAdapter = {
  meta: {
    id: "dynamic",
    label: "Détection dynamique (CSV inconnu)",
    description:
      "Auto-associe les colonnes par mots-clés (Date, Prix, Quantité…). Mapping manuel si incertain.",
  },
  detect(headers) {
    const m = autoMatchHeaders(headers);
    // Always available as fallback; score reflects quality
    return Math.max(5, Math.min(70, m.score));
  },
  parse(input: AdapterParseInput): AdapterParseResult {
    const auto = autoMatchHeaders(input.headers);
    const columnMap = mergeColumnMaps(auto.columnMap, input.columnMap);
    const final = autoMatchHeaders(input.headers);
    // Re-evaluate missing with merged map
    const roles = new Set(Object.values(columnMap));
    const missing = auto.missingRoles.filter((r) => {
      if (r === "type") return !roles.has("type") && !roles.has("side");
      if (r === "ticker") return !roles.has("ticker") && !roles.has("name");
      if (r === "unitPrice")
        return !roles.has("unitPrice") && !roles.has("cashAmount");
      return !roles.has(r);
    });

    const confidence =
      missing.length === 0
        ? "high"
        : missing.length <= 1
          ? "medium"
          : auto.confidence;

    const transactions: TransactionImport[] = [];
    const warnings: string[] = [
      ...(missing.length ? [`Colonnes manquantes : ${missing.join(", ")}`] : []),
    ];

    input.rows.forEach((row, idx) => {
      const { tx, errors, warnings: w } = rowToTransactionImport(
        row,
        columnMap,
        idx + 2
      );
      warnings.push(...w.map((x) => `L${idx + 2}: ${x}`));
      if (tx && errors.length === 0 && tx.type !== "OTHER") {
        transactions.push(tx);
      }
    });

    return {
      transactions,
      columnMap,
      warnings,
      needsManualMapping:
        (mappingNeedsUserInput({
          ...final,
          columnMap,
          missingRoles: missing,
          confidence,
        }) ||
          missing.length > 0) &&
        !input.columnMap,
      confidence,
    };
  },
};
