/**
 * Registry Strategy Pattern — détection et sélection d'adaptateur.
 */

import type { ColumnRole, PlatformAdapterId, PlatformCsvAdapter } from "../types";
import { createAliasAdapter, type AliasPreset } from "./alias-adapter";
import { dynamicAdapter } from "./dynamic-adapter";
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
  (f) => f.id !== "dynamic"
).map((p) => createAliasAdapter(presetToAlias(p)));

/** Tous les adaptateurs (plateformes + dynamic en dernier) */
export const PLATFORM_ADAPTERS: PlatformCsvAdapter[] = [
  ...aliasAdapters,
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
 */
export function detectBestAdapter(headers: string[]): {
  adapter: PlatformCsvAdapter;
  score: number;
  ranking: Array<{ id: string; score: number; label: string }>;
} {
  const ranking = PLATFORM_ADAPTERS.map((a) => ({
    id: a.meta.id,
    label: a.meta.label,
    score: a.detect(headers),
  })).sort((a, b) => b.score - a.score);

  const best = ranking[0]!;
  if (best.score >= 40 && best.id !== "dynamic") {
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
