/**
 * Slice multi-custody des holdings crypto.
 * - Sans filtre plateforme : la ligne reste agrégée (qty A+B).
 * - Avec ?platformId= : métriques affichées = jambe de cette plateforme.
 */

export type HoldingPlatformSlice = {
  platformId: string;
  platformName: string;
  platformLogoUrl?: string | null;
  platformType?: string | null;
  platformLogoKey?: string | null;
  assetId: string;
  blockchainKey?: string | null;
  blockchainLabel?: string | null;
  quantity: string;
  costBasisEur: string;
  costBasisBase: string;
  marketValueEur: string;
  marketValueBase: string;
  acquisitionFeesEur: string;
  acquisitionFeesBase: string;
  passiveIncomeEur: string;
  passiveIncomeBase: string;
  unrealizedPnlEur: string;
  unrealizedPnlBase: string;
};

/** Champs minimum pour appliquer un slice (Holding / HoldingRow). */
export type HoldingSliceable = {
  assetId: string;
  platformId: string;
  platformIds?: string[];
  platformName: string;
  platformLogoUrl?: string | null;
  platformType?: string | null;
  platformLogoKey?: string | null;
  blockchainKey?: string | null;
  blockchainLabel?: string | null;
  platformSlices?: HoldingPlatformSlice[];
  quantity: string;
  avgCostEur: string;
  costBasisEur: string;
  costBasisBase: string;
  marketValueEur: string;
  marketValueBase: string;
  unrealizedPnlEur: string;
  unrealizedPnlBase: string;
  unrealizedPnlPct: string;
  acquisitionFeesEur?: string;
  acquisitionFeesBase?: string;
  passiveIncomeEur?: string;
  passiveIncomeBase?: string;
  breakEvenEur?: string;
  breakEvenBase?: string;
  allocationPct?: string;
  allocationPctOfClass?: string;
  currentPriceEur?: string;
};

function n(v: string | number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Format stable 8 décimales (aligné service portfolio). */
export function sliceFixed(v: number, digits = 8): string {
  if (!Number.isFinite(v)) return (0).toFixed(digits);
  return v.toFixed(digits);
}

export function holdingMatchesPlatform(
  h: { platformId: string; platformIds?: string[] },
  platformFilterId: string
): boolean {
  if (!platformFilterId) return true;
  const ids =
    h.platformIds && h.platformIds.length > 0
      ? h.platformIds
      : [h.platformId];
  return ids.includes(platformFilterId);
}

/** Construit un slice à partir d’une ligne mono-jambe. */
export function sliceFromHoldingLeg(
  h: HoldingSliceable & { platformId: string }
): HoldingPlatformSlice {
  return {
    platformId: h.platformId,
    platformName: h.platformName.split(",")[0]?.trim() || h.platformName,
    platformLogoUrl: h.platformLogoUrl ?? null,
    platformType: h.platformType ?? null,
    platformLogoKey: h.platformLogoKey ?? null,
    assetId: h.assetId,
    blockchainKey: h.blockchainKey ?? null,
    blockchainLabel: h.blockchainLabel ?? null,
    quantity: h.quantity,
    costBasisEur: h.costBasisEur,
    costBasisBase: h.costBasisBase,
    marketValueEur: h.marketValueEur,
    marketValueBase: h.marketValueBase,
    acquisitionFeesEur: h.acquisitionFeesEur ?? "0",
    acquisitionFeesBase: h.acquisitionFeesBase ?? "0",
    passiveIncomeEur: h.passiveIncomeEur ?? "0",
    passiveIncomeBase: h.passiveIncomeBase ?? "0",
    unrealizedPnlEur: h.unrealizedPnlEur,
    unrealizedPnlBase: h.unrealizedPnlBase,
  };
}

/**
 * Fusionne les slices par platformId (somme des montants / quantités).
 * Utilisé au merge crypto multi-custody côté service.
 */
export function mergePlatformSlices(
  a: HoldingPlatformSlice[],
  b: HoldingPlatformSlice[]
): HoldingPlatformSlice[] {
  const map = new Map<string, HoldingPlatformSlice>();
  for (const s of [...a, ...b]) {
    const prev = map.get(s.platformId);
    if (!prev) {
      map.set(s.platformId, { ...s });
      continue;
    }
    const qty = n(prev.quantity) + n(s.quantity);
    const cost = n(prev.costBasisEur) + n(s.costBasisEur);
    const costBase = n(prev.costBasisBase) + n(s.costBasisBase);
    const mv = n(prev.marketValueEur) + n(s.marketValueEur);
    const mvBase = n(prev.marketValueBase) + n(s.marketValueBase);
    const fees = n(prev.acquisitionFeesEur) + n(s.acquisitionFeesEur);
    const feesBase = n(prev.acquisitionFeesBase) + n(s.acquisitionFeesBase);
    const income = n(prev.passiveIncomeEur) + n(s.passiveIncomeEur);
    const incomeBase = n(prev.passiveIncomeBase) + n(s.passiveIncomeBase);
    const unreal = mv - cost;
    const unrealBase = n(prev.unrealizedPnlBase) + n(s.unrealizedPnlBase);
    // assetId de la jambe la plus lourde
    const takeB = n(s.quantity) > n(prev.quantity);
    map.set(s.platformId, {
      platformId: s.platformId,
      platformName: takeB ? s.platformName : prev.platformName,
      platformLogoUrl: takeB
        ? s.platformLogoUrl ?? prev.platformLogoUrl
        : prev.platformLogoUrl ?? s.platformLogoUrl,
      platformType: takeB
        ? s.platformType ?? prev.platformType
        : prev.platformType ?? s.platformType,
      platformLogoKey: takeB
        ? s.platformLogoKey ?? prev.platformLogoKey
        : prev.platformLogoKey ?? s.platformLogoKey,
      assetId: takeB ? s.assetId : prev.assetId,
      blockchainKey: prev.blockchainKey || s.blockchainKey,
      blockchainLabel: prev.blockchainLabel || s.blockchainLabel,
      quantity: sliceFixed(qty),
      costBasisEur: sliceFixed(cost),
      costBasisBase: sliceFixed(costBase),
      marketValueEur: sliceFixed(mv),
      marketValueBase: sliceFixed(mvBase),
      acquisitionFeesEur: sliceFixed(fees),
      acquisitionFeesBase: sliceFixed(feesBase),
      passiveIncomeEur: sliceFixed(income),
      passiveIncomeBase: sliceFixed(incomeBase),
      unrealizedPnlEur: sliceFixed(unreal),
      unrealizedPnlBase: sliceFixed(unrealBase),
    });
  }
  return [...map.values()];
}

/**
 * Applique le filtre plateforme aux métriques d’affichage d’une ligne.
 * Sans slice pour cette plateforme → ligne inchangée (cas mono / rétrocompat).
 * Conserve platformSlices complet (détail multi-custody toujours dispo).
 */
export function applyPlatformFilterToHolding<T extends HoldingSliceable>(
  h: T,
  platformFilterId: string
): T {
  if (!platformFilterId) return h;

  const slices =
    h.platformSlices && h.platformSlices.length > 0
      ? h.platformSlices
      : [sliceFromHoldingLeg(h)];

  const s = slices.find((x) => x.platformId === platformFilterId);
  if (!s) return h;

  // Mono-jambe déjà correcte → pas de recompute inutile
  const multi = (h.platformIds?.length ?? slices.length) > 1;
  if (!multi && h.platformId === platformFilterId) {
    return {
      ...h,
      platformName: s.platformName,
      platformSlices: slices,
    };
  }

  const qty = n(s.quantity);
  const cost = n(s.costBasisEur);
  const costBase = n(s.costBasisBase);
  const mv = n(s.marketValueEur);
  const mvBase = n(s.marketValueBase);
  const unreal = mv - cost;
  const unrealBase = n(s.unrealizedPnlBase);
  const avg = qty > 0 ? cost / qty : 0;
  const pct = cost > 0 ? (unreal / cost) * 100 : 0;
  // Cours unitaire : mv/qty si dispo, sinon conserve le cours agrégé
  const unitPx =
    qty > 0 && mv > 0
      ? mv / qty
      : n(h.currentPriceEur) > 0
        ? n(h.currentPriceEur)
        : avg;

  return {
    ...h,
    assetId: s.assetId,
    platformId: s.platformId,
    platformName: s.platformName,
    platformLogoUrl: s.platformLogoUrl ?? h.platformLogoUrl,
    platformType: s.platformType ?? h.platformType,
    platformLogoKey: s.platformLogoKey ?? h.platformLogoKey,
    blockchainKey: s.blockchainKey ?? h.blockchainKey,
    blockchainLabel: s.blockchainLabel ?? h.blockchainLabel,
    // platformIds reste la liste complète pour le bandeau / cohérence filtre
    // (la ligne est déjà filtrée ; on expose la jambe active via platformId)
    quantity: sliceFixed(qty),
    costBasisEur: sliceFixed(cost),
    costBasisBase: sliceFixed(costBase),
    marketValueEur: sliceFixed(mv),
    marketValueBase: sliceFixed(mvBase),
    avgCostEur: sliceFixed(avg),
    breakEvenEur: sliceFixed(avg),
    breakEvenBase: sliceFixed(qty > 0 ? costBase / qty : 0),
    unrealizedPnlEur: sliceFixed(unreal),
    unrealizedPnlBase: sliceFixed(unrealBase),
    unrealizedPnlPct: sliceFixed(pct, 4),
    acquisitionFeesEur: sliceFixed(n(s.acquisitionFeesEur)),
    acquisitionFeesBase: sliceFixed(n(s.acquisitionFeesBase)),
    passiveIncomeEur: sliceFixed(n(s.passiveIncomeEur)),
    passiveIncomeBase: sliceFixed(n(s.passiveIncomeBase)),
    currentPriceEur: sliceFixed(unitPx),
    platformSlices: slices,
  };
}

/**
 * Recalcule allocation % sur l’ensemble filtré (somme MV des lignes visibles).
 */
export function recomputeAllocationsForFiltered<
  T extends HoldingSliceable & { assetClass: string },
>(rows: T[]): T[] {
  const totalMv = rows.reduce((acc, r) => acc + n(r.marketValueEur), 0);
  const byClass = new Map<string, number>();
  for (const r of rows) {
    byClass.set(
      r.assetClass,
      (byClass.get(r.assetClass) || 0) + n(r.marketValueEur)
    );
  }
  return rows.map((r) => {
    const mv = n(r.marketValueEur);
    const classTotal = byClass.get(r.assetClass) || 0;
    return {
      ...r,
      allocationPct:
        totalMv > 0 ? sliceFixed((mv / totalMv) * 100, 4) : "0.0000",
      allocationPctOfClass:
        classTotal > 0 ? sliceFixed((mv / classTotal) * 100, 4) : "0.0000",
    };
  });
}
