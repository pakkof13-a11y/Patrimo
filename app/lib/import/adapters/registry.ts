/**
 * Registry Strategy Pattern — détection et sélection d'adaptateur.
 */

import type { ColumnRole, PlatformAdapterId, PlatformCsvAdapter } from "../types";
import { createAliasAdapter, type AliasPreset } from "./alias-adapter";
import { dynamicAdapter } from "./dynamic-adapter";
import { hyperliquidTradeAdapter } from "./hyperliquid-trade-adapter";
import { hyperliquidFundingAdapter } from "./hyperliquid-funding-adapter";
import { nexoAdapter } from "./nexo-adapter";
import { IMPORT_FORMATS } from "../presets";

function presetToAlias(p: (typeof IMPORT_FORMATS)[number]): AliasPreset {
  return {
    id: p.id as PlatformAdapterId,
    label: p.label,
    description: p.description,
    aliases: p.aliases as Record<string, ColumnRole>,
    detectHints: Object.keys(p.aliases).slice(0, 12),
  };
}

const aliasAdapters: PlatformCsvAdapter[] = IMPORT_FORMATS.filter(
  (f) => f.id !== "dynamic" && f.id !== "nexo"
).map((p) => createAliasAdapter(presetToAlias(p)));

/** Tous les adaptateurs (plateformes + dynamic en dernier) */
export const PLATFORM_ADAPTERS: PlatformCsvAdapter[] = [
  ...aliasAdapters,
  hyperliquidTradeAdapter,
  hyperliquidFundingAdapter,
  nexoAdapter,
  dynamicAdapter,
];

export function getAdapter(id: PlatformAdapterId | string): PlatformCsvAdapter {
  return PLATFORM_ADAPTERS.find((a) => a.meta.id === id) || dynamicAdapter;
}

export function listAdapters(): PlatformCsvAdapter[] {
  return PLATFORM_ADAPTERS;
}

/**
 * Choisit l'adaptateur le mieux score pour un jeu d'en-têtes.
 * Si tout est faible → dynamic.
 * Si 2 formats proches (≥40 et écart < 12) → ambiguous (demander à l’utilisateur).
 */
export function detectBestAdapter(headers: string[]): {
  adapter: PlatformCsvAdapter;
  score: number;
  ranking: Array<{ id: string; score: number; label: string }>;
  /** Formats plausibles en concurrence — l’UI doit demander confirmation */
  ambiguous?: Array<{ id: string; score: number; label: string }>;
} {
  const ranking = PLATFORM_ADAPTERS.map((a) => ({
    id: a.meta.id,
    label: a.meta.label,
    score: a.detect(headers),
  })).sort((a, b) => b.score - a.score);

  const best = ranking[0]!;
  const second = ranking[1];

  if (best.score >= 40 && best.id !== "dynamic") {
    // Ambiguïté : second aussi fort et pas « dynamic »
    if (
      second &&
      second.id !== "dynamic" &&
      second.score >= 40 &&
      best.score - second.score < 12
    ) {
      const ambiguous = ranking.filter(
        (r) => r.id !== "dynamic" && r.score >= 40 && best.score - r.score < 12
      );
      return {
        adapter: getAdapter(best.id),
        score: best.score,
        ranking,
        ambiguous: ambiguous.length > 1 ? ambiguous : undefined,
      };
    }
    return {
      adapter: getAdapter(best.id),
      score: best.score,
      ranking,
    };
  }
  const dyn = getAdapter("dynamic");
  return {
    adapter: dyn,
    score: dyn.detect(headers),
    ranking,
  };
}
