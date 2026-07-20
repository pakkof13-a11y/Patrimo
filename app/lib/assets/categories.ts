/**
 * Sous-catégories d’actifs — classification UI uniquement.
 * Ne participe pas aux calculs ledger / CUMP / P&L.
 */

import type { AccountType } from "@/app/lib/constants";

/** Codes stables stockés en base (Asset.category). */
export const ASSET_CATEGORIES = [
  "EQUITY",
  "ETF",
  "BOND",
  "MONEY_MARKET",
  "FUND",
  "REIT",
  "CRYPTO",
  "CASH_EQUIVALENT",
  "SCPI",
  "REAL_ESTATE_DIRECT",
  "PRIVATE_EQUITY",
  "COMMODITY",
  "DERIVATIVE",
  "OTHER",
  "UNCLASSIFIED",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  EQUITY: "Actions",
  ETF: "ETF",
  BOND: "Obligations",
  MONEY_MARKET: "Monétaire",
  FUND: "Fonds",
  REIT: "Foncières cotées / REIT",
  CRYPTO: "Cryptomonnaies",
  CASH_EQUIVALENT: "Liquidités et équivalents",
  SCPI: "SCPI",
  REAL_ESTATE_DIRECT: "Immobilier direct",
  PRIVATE_EQUITY: "Private equity",
  COMMODITY: "Matières premières",
  DERIVATIVE: "Produits dérivés",
  OTHER: "Autres actifs",
  UNCLASSIFIED: "Non classé",
};

/** Ordre métier stable (Non classé toujours en dernier). */
export const ASSET_CATEGORY_ORDER: readonly AssetCategory[] = [
  "EQUITY",
  "ETF",
  "BOND",
  "MONEY_MARKET",
  "FUND",
  "REIT",
  "SCPI",
  "REAL_ESTATE_DIRECT",
  "PRIVATE_EQUITY",
  "COMMODITY",
  "CRYPTO",
  "DERIVATIVE",
  "CASH_EQUIVALENT",
  "OTHER",
  "UNCLASSIFIED",
];

/** Suggestions d’UI par enveloppe (non bloquantes côté serveur). */
export const CATEGORIES_BY_ENVELOPE: Record<
  AccountType | "ALL",
  readonly AssetCategory[]
> = {
  ALL: ASSET_CATEGORY_ORDER,
  PEA: ["EQUITY", "ETF", "FUND", "CASH_EQUIVALENT", "UNCLASSIFIED"],
  CTO: [
    "EQUITY",
    "ETF",
    "BOND",
    "MONEY_MARKET",
    "FUND",
    "REIT",
    "COMMODITY",
    "DERIVATIVE",
    "OTHER",
    "UNCLASSIFIED",
  ],
  AV: [
    "FUND",
    "ETF",
    "EQUITY",
    "BOND",
    "MONEY_MARKET",
    "SCPI",
    "PRIVATE_EQUITY",
    "CASH_EQUIVALENT",
    "UNCLASSIFIED",
  ],
  CRYPTO: ["CRYPTO", "DERIVATIVE", "CASH_EQUIVALENT", "UNCLASSIFIED"],
  IMMOBILIER: [
    "REAL_ESTATE_DIRECT",
    "SCPI",
    "REIT",
    "PRIVATE_EQUITY",
    "OTHER",
    "UNCLASSIFIED",
  ],
  CFD: ["DERIVATIVE", "COMMODITY", "EQUITY", "ETF", "UNCLASSIFIED"],
};

export function isAssetCategory(v: unknown): v is AssetCategory {
  return (
    typeof v === "string" &&
    (ASSET_CATEGORIES as readonly string[]).includes(v)
  );
}

export function parseAssetCategory(v: unknown): AssetCategory {
  if (isAssetCategory(v)) return v;
  return "UNCLASSIFIED";
}

export function assetCategoryLabel(code: string | null | undefined): string {
  return ASSET_CATEGORY_LABELS[parseAssetCategory(code)];
}

export function categoryOrderIndex(code: AssetCategory): number {
  const i = ASSET_CATEGORY_ORDER.indexOf(code);
  return i < 0 ? ASSET_CATEGORY_ORDER.length : i;
}

/** Suggestions pour une enveloppe + le reste (suggestions d’abord). */
export function categoriesForEnvelope(
  envelope: AccountType | null | undefined
): {
  suggested: AssetCategory[];
  other: AssetCategory[];
} {
  const key = (envelope || "ALL") as AccountType | "ALL";
  const suggestedList = [
    ...(CATEGORIES_BY_ENVELOPE[key] ?? CATEGORIES_BY_ENVELOPE.ALL),
  ];
  const suggestedSet = new Set(suggestedList);
  const other = ASSET_CATEGORY_ORDER.filter((c) => !suggestedSet.has(c));
  return { suggested: suggestedList, other };
}

/**
 * Backfill prudent depuis assetClass existant uniquement (pas de ticker).
 * ACTIONS reste UNCLASSIFIED (ETF vs action non fiable).
 */
export function suggestCategoryFromAssetClass(
  assetClass: string | null | undefined
): AssetCategory {
  switch ((assetClass || "").toUpperCase()) {
    case "CRYPTO":
      return "CRYPTO";
    case "OBLIGATIONS":
      return "BOND";
    case "CASH":
      return "CASH_EQUIVALENT";
    case "IMMOBILIER":
      return "UNCLASSIFIED";
    case "ACTIONS":
    case "AUTRE":
    default:
      return "UNCLASSIFIED";
  }
}

/** Champs nécessaires pour regrouper / agréger (pas de recalcul métier). */
export type GroupableHolding = {
  assetId: string;
  category?: string | null;
  marketValueBase: string;
  unrealizedPnlBase: string;
};

export type PositionCategoryGroup<T extends GroupableHolding> = {
  category: AssetCategory;
  label: string;
  positions: T[];
  count: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  /** Poids dans le périmètre filtré (0–100), null si total global ≤ 0 */
  weightPct: number | null;
};

function num(s: string | null | undefined): number {
  const n = Number(String(s ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Regroupe des positions déjà filtrées (enveloppe / recherche côté appelant).
 * - Groupes vides omis
 * - Ordre métier stable
 * - Totaux uniquement sur les lignes fournies
 * - Ne modifie jamais les positions
 */
export function groupPositionsByAssetCategory<T extends GroupableHolding>(
  positions: readonly T[]
): PositionCategoryGroup<T>[] {
  const buckets = new Map<AssetCategory, T[]>();

  for (const p of positions) {
    const cat = parseAssetCategory(p.category);
    const list = buckets.get(cat);
    if (list) list.push(p);
    else buckets.set(cat, [p]);
  }

  const scopeTotal = positions.reduce(
    (acc, p) => acc + num(p.marketValueBase),
    0
  );

  const groups: PositionCategoryGroup<T>[] = [];

  for (const cat of ASSET_CATEGORY_ORDER) {
    const list = buckets.get(cat);
    if (!list?.length) continue;
    const totalMarketValue = list.reduce(
      (acc, p) => acc + num(p.marketValueBase),
      0
    );
    const totalUnrealizedPnl = list.reduce(
      (acc, p) => acc + num(p.unrealizedPnlBase),
      0
    );
    groups.push({
      category: cat,
      label: ASSET_CATEGORY_LABELS[cat],
      positions: list,
      count: list.length,
      totalMarketValue,
      totalUnrealizedPnl,
      weightPct:
        scopeTotal > 0
          ? Math.round((totalMarketValue / scopeTotal) * 1000) / 10
          : null,
    });
  }

  return groups;
}

export type HoldingsGroupBy = "none" | "assetCategory" | "blockchain";

export function parseHoldingsGroupBy(v: string | null | undefined): HoldingsGroupBy {
  if (v === "assetCategory" || v === "category") return "assetCategory";
  if (v === "blockchain" || v === "chain") return "blockchain";
  return "none";
}
