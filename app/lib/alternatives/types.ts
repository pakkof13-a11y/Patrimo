export const PRECIOUS_ASSET_KINDS = ["METAL", "OTHER"] as const;
export type PreciousAssetKind = (typeof PRECIOUS_ASSET_KINDS)[number];

export const PRECIOUS_FORMATS = ["PHYSICAL", "PAPER"] as const;
export type PreciousFormat = (typeof PRECIOUS_FORMATS)[number];

export const WEIGHT_UNITS = ["GRAM", "OZ"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const ASSET_KIND_LABELS: Record<PreciousAssetKind, string> = {
  METAL: "Métal précieux",
  OTHER: "Autre",
};

export const FORMAT_LABELS: Record<PreciousFormat, string> = {
  PHYSICAL: "Physique",
  PAPER: "Papier",
};

export const WEIGHT_UNIT_LABELS: Record<WeightUnit, string> = {
  GRAM: "Grammes (g)",
  OZ: "Onces troy (oz)",
};

/** 1 troy ounce = 31.1034768 g */
export const GRAMS_PER_TROY_OZ = 31.1034768;

export type PreciousMetalDto = {
  id: string;
  assetKind: PreciousAssetKind;
  format: PreciousFormat;
  denomination: string;
  quantity: string;
  unitWeightG: string;
  weightUnit: WeightUnit;
  /** Poids unitaire affiché dans l’unité saisie */
  unitWeightDisplay: string;
  purchasePriceUnit: string;
  currentValue: string;
  currency: string;
  storageLocation: string | null;
  notes: string | null;
  /** quantity × PRU */
  costBasis: string;
  /** currentValue − costBasis */
  unrealizedPnl: string;
  /** % vs cost basis */
  unrealizedPnlPct: string;
  /** quantity × unitWeightG */
  totalWeightG: string;
};

export type PreciousMetalsSummary = {
  totalCost: string;
  totalValue: string;
  totalPnl: string;
  totalPnlPct: number;
  totalWeightG: string;
  lineCount: number;
  byFormat: { name: string; value: number }[];
  byKind: { name: string; value: number }[];
};

export type AlternativesSubTab =
  | "dashboard"
  | "metals"
  | "private-equity"
  | "crowdlending"
  | "tangibles";

// ─── Actifs tangibles / collection ────────────────────────────────────────────

export const TANGIBLE_CATEGORIES = [
  "WATCHES",
  "WINE",
  "ART",
  "AUTO",
  "OTHER",
] as const;
export type TangibleCategory = (typeof TANGIBLE_CATEGORIES)[number];

export const TANGIBLE_CATEGORY_LABELS: Record<TangibleCategory, string> = {
  WATCHES: "Montres",
  WINE: "Vins",
  ART: "Art",
  AUTO: "Auto",
  OTHER: "Autre",
};

export type TangibleAssetDto = {
  id: string;
  category: TangibleCategory;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage: string | null;
  purchasePrice: string;
  estimatedValue: string;
  currency: string;
  hasCertificate: boolean;
  notes: string | null;
  unrealizedPnl: string;
  unrealizedPnlPct: string;
};

export type TangibleAssetsSummary = {
  totalCost: string;
  totalValue: string;
  totalPnl: string;
  totalPnlPct: number;
  lineCount: number;
  byCategory: { name: string; value: number }[];
};

/** Agrégat des 4 poches alternatives (valeurs en EUR) */
export type AlternativesPortfolioSlice = {
  metalsEur: number;
  privateEquityEur: number;
  crowdlendingEur: number;
  tangiblesEur: number;
  totalEur: number;
  slices: { id: string; name: string; value: number }[];
};

/**
 * Payload unique pour le dashboard Alternatifs (1 HTTP au lieu d’un fan-out 5).
 * Les sous-modules continuent d’utiliser leurs endpoints list pour le détail.
 */
export type AlternativesDashboardPayload = {
  summary: AlternativesPortfolioSlice;
  metals: PreciousMetalsSummary;
  privateEquity: PrivateEquitySummary;
  crowdlending: CrowdlendingSummary;
  tangibles: TangibleAssetsSummary;
};

// ─── Private equity ───────────────────────────────────────────────────────────

export const PE_TYPES = ["CROWDEQUITY", "CLUB_DEAL", "DIRECT", "HOLDING"] as const;
export type PeType = (typeof PE_TYPES)[number];

export const PE_TYPE_LABELS: Record<PeType, string> = {
  CROWDEQUITY: "Crowdequity",
  CLUB_DEAL: "Club Deal",
  DIRECT: "Direct",
  HOLDING: "Holding",
};

export type PrivateEquityDto = {
  id: string;
  companyName: string;
  sector: string | null;
  peType: PeType;
  shares: string;
  acquisitionPricePerShare: string;
  investmentDate: string | null;
  currentNav: string;
  currency: string;
  notes: string | null;
  /** shares × PRU */
  investedTotal: string;
  /** MOIC = currentNav / investedTotal */
  moic: string;
  unrealizedPnl: string;
  unrealizedPnlPct: string;
};

export type PrivateEquitySummary = {
  totalInvested: string;
  totalNav: string;
  totalPnl: string;
  avgMoic: number;
  lineCount: number;
};

// ─── Crowdlending ─────────────────────────────────────────────────────────────

export const CL_REPAYMENT_TYPES = ["IN_FINE", "AMORTIZING"] as const;
export type ClRepaymentType = (typeof CL_REPAYMENT_TYPES)[number];

export const CL_REPAYMENT_LABELS: Record<ClRepaymentType, string> = {
  IN_FINE: "In fine",
  AMORTIZING: "Amortissable",
};

export const CL_STATUSES = ["ACTIVE", "LATE", "REPAID", "DEFAULT"] as const;
export type ClStatus = (typeof CL_STATUSES)[number];

export const CL_STATUS_LABELS: Record<ClStatus, string> = {
  ACTIVE: "En cours",
  LATE: "En retard",
  REPAID: "Remboursé",
  DEFAULT: "Défaut",
};

export type CrowdlendingDto = {
  id: string;
  projectName: string;
  platform: string | null;
  capitalInvested: string;
  annualYieldPercent: string;
  durationMonths: number;
  repaymentType: ClRepaymentType;
  startDate: string | null;
  maturityDate: string | null;
  status: ClStatus;
  currency: string;
  notes: string | null;
  /** Mois restants jusqu'à échéance (négatif si dépassé) */
  monthsRemaining: number | null;
  /** 0–100 progression du prêt (temps) */
  progressPct: number | null;
};

export type CrowdlendingSummary = {
  totalCapital: string;
  activeCapital: string;
  lineCount: number;
  byStatus: { status: string; label: string; count: number; capital: number }[];
};
