/** KPI de synthèse pour l'onglet Mes plateformes — fonction pure. */

export type SummarizablePlatform = {
  type: string;
  positionCount?: number;
  totalValueBase?: string;
  totalValueEur?: string;
  cashBase?: string;
  cashEur?: string;
};

export type PlatformsSummary = {
  activeCount: number;
  inactiveCount: number;
  totalValue: number;
  /** Par type, valeur agrégée décroissante */
  byType: Array<{ type: string; value: number; count: number }>;
};

function resolveValue(p: SummarizablePlatform): number {
  const raw = p.totalValueBase || p.totalValueEur || p.cashBase || p.cashEur || "0";
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function summarizePlatforms(
  platforms: SummarizablePlatform[]
): PlatformsSummary {
  let activeCount = 0;
  let inactiveCount = 0;
  let totalValue = 0;
  const byTypeMap = new Map<string, { value: number; count: number }>();

  for (const p of platforms) {
    const value = resolveValue(p);
    totalValue += value;
    if ((p.positionCount ?? 0) > 0) activeCount += 1;
    else inactiveCount += 1;

    const entry = byTypeMap.get(p.type) || { value: 0, count: 0 };
    entry.value += value;
    entry.count += 1;
    byTypeMap.set(p.type, entry);
  }

  const byType = [...byTypeMap.entries()]
    .map(([type, { value, count }]) => ({ type, value, count }))
    .sort((a, b) => b.value - a.value);

  return { activeCount, inactiveCount, totalValue, byType };
}
