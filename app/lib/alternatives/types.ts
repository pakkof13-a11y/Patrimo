/**
 * Le vocabulaire des métaux précieux vit dans `precious-metals/constants.ts` —
 * fichier sans dépendance à Prisma, donc importable par les formulaires. On le
 * réexporte ici pour ne pas casser les imports existants.
 */
export {
  FORMAT_LABELS,
  GRAMS_PER_TROY_OZ,
  METAL_LABELS,
  PRECIOUS_FORMATS,
  PRECIOUS_METALS,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type PreciousFormat,
  type PreciousMetal,
  type PreciousProductType,
  type WeightUnit,
} from "@/app/lib/precious-metals/constants";

import type {
  PreciousFormat,
  PreciousMetal,
  PreciousProductType,
  WeightUnit,
} from "@/app/lib/precious-metals/constants";

export type PreciousMetalDto = {
  id: string;
  metal: PreciousMetal;
  format: PreciousFormat;
  productType: PreciousProductType;
  denomination: string;
  /** Titre en millièmes — 900 pour un Napoléon, 999,9 pour un lingot. */
  fineness: string;
  quantity: string;
  unitWeightG: string;
  weightUnit: WeightUnit;
  /** Poids unitaire affiché dans l’unité saisie */
  unitWeightDisplay: string;
  purchasePriceUnit: string;
  acquisitionFees: string;
  /** ISO — sans elle, pas d'abattement pour durée de détention. */
  acquiredAt: string | null;
  /** Facture nominative datée : condition de l'option 2092-SD. */
  hasInvoice: boolean;
  currentValue: string;
  currency: string;
  storageLocation: string | null;
  notes: string | null;
  /** quantity × PRU + frais d'acquisition */
  costBasis: string;
  /** currentValue − costBasis */
  unrealizedPnl: string;
  /** % vs cost basis */
  unrealizedPnlPct: string;
  /** quantity × unitWeightG — poids brut */
  totalWeightG: string;
  /** Poids brut × titre : le seul comparable d'un métal à l'autre. */
  fineWeightG: string;
  unitValueEur: string;
};

export type PreciousMetalsSummary = {
  totalCost: string;
  totalValue: string;
  totalPnl: string;
  totalPnlPct: number;
  totalWeightG: string;
  totalFineWeightG: string;
  lineCount: number;
  /** Lots sans date d'acquisition — option fiscale fermée. */
  undatedCount: number;
  /** Lots physiques sans justificatif — option fiscale fermée. */
  noInvoiceCount: number;
  byFormat: { name: string; value: number }[];
  byMetal: {
    metal: string;
    name: string;
    value: number;
    fineWeightG: string;
  }[];
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
