/**
 * Regroupement du portefeuille par **classe d'actifs**.
 *
 * Distinct de `groupPositionsByAssetCategory` : celui-là travaille sur la
 * sous-catégorie d'affichage (Actions, ETF, SCPI, Produits dérivés…), plus
 * fine mais purement cosmétique. Ici on regroupe sur `assetClass`, la
 * taxonomie que partage le reste de l'application — allocation du tableau de
 * bord, P&L journalier par classe, couleurs de graphique. C'est ce qui permet
 * d'accrocher une courbe et une variation du jour réelles à chaque groupe :
 * `/api/portfolio/class-pnl` est indexé sur cette clé, pas sur la
 * sous-catégorie.
 */

import { ASSET_CLASSES, type AssetClass } from "@/app/lib/constants";

/** Ordre de lecture : le patrimoine coté d'abord, « Autre » en dernier. */
export const ASSET_CLASS_ORDER: readonly AssetClass[] = [
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
  "IMMOBILIER",
  "CASH",
  "AUTRE",
];

export function parseAssetClass(v: string | null | undefined): AssetClass {
  const key = (v || "").toUpperCase();
  return (key in ASSET_CLASSES ? key : "AUTRE") as AssetClass;
}

export function assetClassLabel(v: string | null | undefined): string {
  return ASSET_CLASSES[parseAssetClass(v)];
}

/** Champs nécessaires au regroupement — aucun recalcul métier ici. */
export type ClassGroupableHolding = {
  assetId: string;
  assetClass: string;
  marketValueBase: string;
  unrealizedPnlBase: string;
  costBasisBase: string;
};

export type AssetClassGroup<T extends ClassGroupableHolding> = {
  assetClass: AssetClass;
  label: string;
  positions: T[];
  count: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  /** P&L latent en % du prix de revient, null si rien n'a été investi. */
  unrealizedPnlPct: number | null;
  /** Poids dans le périmètre affiché (0–100), null si le total est nul. */
  weightPct: number | null;
};

function num(s: string | null | undefined): number {
  const n = Number(String(s ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Regroupe des positions **déjà filtrées**. Les totaux ne portent donc que sur
 * les lignes fournies : un poids calculé sur le portefeuille entier ne
 * s'additionnerait pas à 100 % sous les yeux de qui vient de filtrer.
 *
 * Groupes vides omis, ordre métier stable, positions jamais modifiées.
 */
export function groupPositionsByAssetClass<T extends ClassGroupableHolding>(
  positions: readonly T[]
): AssetClassGroup<T>[] {
  const buckets = new Map<AssetClass, T[]>();
  for (const p of positions) {
    const cls = parseAssetClass(p.assetClass);
    const list = buckets.get(cls);
    if (list) list.push(p);
    else buckets.set(cls, [p]);
  }

  const scopeTotal = positions.reduce(
    (acc, p) => acc + num(p.marketValueBase),
    0
  );

  const groups: AssetClassGroup<T>[] = [];
  for (const cls of ASSET_CLASS_ORDER) {
    const list = buckets.get(cls);
    if (!list?.length) continue;

    let totalMarketValue = 0;
    let totalCostBasis = 0;
    let totalUnrealizedPnl = 0;
    for (const p of list) {
      totalMarketValue += num(p.marketValueBase);
      totalCostBasis += num(p.costBasisBase);
      totalUnrealizedPnl += num(p.unrealizedPnlBase);
    }

    groups.push({
      assetClass: cls,
      label: ASSET_CLASSES[cls],
      positions: list,
      count: list.length,
      totalMarketValue,
      totalCostBasis,
      totalUnrealizedPnl,
      unrealizedPnlPct:
        totalCostBasis > 0 ? (totalUnrealizedPnl / totalCostBasis) * 100 : null,
      weightPct:
        scopeTotal > 0
          ? Math.round((totalMarketValue / scopeTotal) * 1000) / 10
          : null,
    });
  }

  return groups;
}
