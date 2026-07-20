import type { AccountType } from "@/app/lib/constants";

export type Holding = {
  assetId: string;
  name: string;
  ticker: string | null;
  /** Optional ISIN when known (search / display) */
  isin?: string | null;
  assetClass: string;
  /**
   * Sous-catégorie UI (EQUITY, ETF, …) — classification uniquement,
   * sans impact sur les calculs de positions.
   */
  category?: string | null;
  accountType: string;
  currency: string;
  platformId: string;
  /** Plateformes de l’agrégat (crypto multi-custody) — filtre Positions */
  platformIds?: string[];
  /**
   * Jambes multi-custody (qty / coût / MV par plateforme).
   * Reslice d’affichage si ?platformId= actif.
   */
  platformSlices?: import("@/app/lib/portfolio/holdings-platform-slice").HoldingPlatformSlice[];
  platformName: string;
  platformLogoUrl: string | null;
  /** Type plateforme (BLOCKCHAIN, EXCHANGE_CRYPTO, …) */
  platformType?: string | null;
  platformLogoKey?: string | null;
  /**
   * Blockchain / lieu de détention UI (ethereum, solana, exchange…).
   * Affichage & regroupement — hors calculs ledger.
   */
  blockchainKey?: string | null;
  blockchainLabel?: string | null;
  assetLogoUrl?: string | null;
  logoUrl?: string | null;
  quantity: string;
  avgCostEur: string;
  costBasisEur: string;
  currentPriceEur: string;
  currentPriceNative: string;
  marketValueEur: string;
  marketValueBase: string;
  costBasisBase: string;
  unrealizedPnlEur: string;
  unrealizedPnlBase: string;
  unrealizedPnlPct: string;
  priceSource: string | null;
  priceStatus: string | null;
  lastUpdatedAt: string | null;
  acquisitionFeesEur?: string;
  acquisitionFeesBase?: string;
  passiveIncomeEur?: string;
  passiveIncomeBase?: string;
  breakEvenEur?: string;
  breakEvenBase?: string;
  allocationPct?: string;
  allocationPctOfClass?: string;
  stopLoss?: string | null;
  tp1?: string | null;
  tp2?: string | null;
  tp3?: string | null;
  tp4?: string | null;
};

export type MainTab =
  | "holdings"
  | "dashboard"
  | "transactions"
  | "platforms"
  | "liabilities"
  | "banques"
  | "av"
  | "cto"
  | "pea"
  | "crypto"
  | "immobilier"
  | "cfd"
  | "epargne-salariale"
  | "alternatifs"
  | "fiscal";

export type PlatformRow = {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  cashEur: string;
  cashBase: string;
  logoUrl: string | null;
  logoKey?: string | null;
  walletAddress?: string | null;
  walletApiKey?: string | null;
  notes?: string | null;
  /** Positions titres ouvertes (qty > 0) */
  positionCount?: number;
  positionsValueEur?: string;
  positionsValueBase?: string;
  /** Cash + titres */
  totalValueEur?: string;
  totalValueBase?: string;
  lastTransactionAt?: string | null;
};

export type TxRow = {
  id: string;
  type: string;
  occurredAt: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  grossAmountEur: string;
  netCashImpactEur: string;
  currency: string;
  fxRateToEur: string;
  cashAmount?: string;
  notes: string | null;
  platformId: string;
  toPlatformId?: string | null;
  assetId?: string | null;
  asset?: {
    name: string;
    ticker?: string | null;
    isin?: string | null;
    accountType?: string | null;
    assetClass?: string | null;
    logoUrl?: string | null;
    notes?: string | null;
    providerSymbol?: string | null;
  } | null;
  platform: {
    name: string;
    logoUrl?: string | null;
    logoKey?: string | null;
    type?: string | null;
    subtype?: string | null;
  };
  toPlatform?: { name: string } | null;
  /** Blockchain dérivée (crypto) */
  blockchainKey?: string | null;
  blockchainLabel?: string | null;
};

export type PortfolioAllocation = {
  byClass: { name: string; value: number }[];
  byPlatform: { name: string; value: number }[];
};

export type HistoryPoint = {
  date: string;
  label: string;
  totalValueEur: number;
  cashTotalEur: number;
  totalValueBase: number;
  cashTotalBase: number;
  /** Positions cotées / non-cash (base) */
  positionsBase?: number;
  /** Plus-values réalisées cumulées (base) */
  realizedPnlBase?: number;
  /** Variation latente cumulée (base) */
  unrealizedPnlBase?: number;
  /** Revenus cash cumulés — div. / coupons / loyers agrégés (base) */
  cashIncomeBase?: number;
  /** Split revenus (base) — dérivé du journal */
  dividendsBase?: number;
  couponsBase?: number;
  rentsBase?: number;
  /** Coût de revient positions (base) */
  totalCostBase?: number;
  isLive?: boolean;
};

export type HoldingsResponse = {
  holdings: Holding[];
  platforms: PlatformRow[];
  summary: Record<string, string | number>;
  allocation: PortfolioAllocation;
  baseCurrency: string;
};

/** Map main tabs that are filtered clones of Positions */
export const TAB_TO_ACCOUNT_TYPE: Partial<Record<MainTab, AccountType>> = {
  cto: "CTO",
  pea: "PEA",
  av: "AV",
  crypto: "CRYPTO",
  immobilier: "IMMOBILIER",
  cfd: "CFD",
};

/** Tabs that show the holdings table (with optional envelope filter). */
export const POSITIONS_TABS: readonly MainTab[] = [
  "holdings",
  "cto",
  "pea",
  "av",
  "crypto",
  "immobilier",
  "cfd",
] as const;

export function isPositionsTab(tab: MainTab): boolean {
  return (POSITIONS_TABS as readonly string[]).includes(tab);
}

/**
 * Navigation primaire (niveau 1) — vues produit.
 * Les enveloppes CTO/PEA/… sont en niveau 2 sous Positions.
 */
export const PRIMARY_NAV: { id: MainTab; label: string }[] = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "holdings", label: "Positions" },
  { id: "banques", label: "Banques" },
  { id: "epargne-salariale", label: "Épargne Salariale" },
  { id: "alternatifs", label: "Actifs Alternatifs" },
  { id: "transactions", label: "Transactions" },
  { id: "fiscal", label: "Fiscalité" },
  { id: "liabilities", label: "Passifs" },
  { id: "platforms", label: "Mes plateformes" },
];

/**
 * Filtre enveloppe (niveau 2) — affiché uniquement sous Positions.
 * `holdings` = toutes les enveloppes cotées.
 */
export const ENVELOPE_NAV: { id: MainTab; label: string; short: string }[] = [
  { id: "holdings", label: "Toutes", short: "Tout" },
  { id: "cto", label: "Compte-Titres", short: "CTO" },
  { id: "pea", label: "PEA", short: "PEA" },
  { id: "av", label: "Assurance-Vie", short: "AV" },
  { id: "crypto", label: "Cryptomonnaies", short: "Crypto" },
  { id: "immobilier", label: "Immobilier", short: "Immo" },
  { id: "cfd", label: "CFD", short: "CFD" },
];

/**
 * @deprecated Préférer PRIMARY_NAV + ENVELOPE_NAV.
 * Conservé pour compat (tests / anciens liens).
 */
export const MAIN_NAV: { id: MainTab; label: string }[] = [
  ...PRIMARY_NAV.slice(0, 2),
  ...ENVELOPE_NAV.filter((e) => e.id !== "holdings").map((e) => ({
    id: e.id,
    label: e.label,
  })),
  ...PRIMARY_NAV.slice(2),
];

export const MAIN_TAB_IDS: readonly MainTab[] = [
  "holdings",
  "dashboard",
  "transactions",
  "platforms",
  "liabilities",
  "banques",
  "av",
  "cto",
  "pea",
  "crypto",
  "immobilier",
  "cfd",
  "epargne-salariale",
  "alternatifs",
  "fiscal",
] as const;

export function isMainTab(v: string): v is MainTab {
  return (MAIN_TAB_IDS as readonly string[]).includes(v);
}

export const TAB_STORAGE_KEY = "patrimo.mainTab";

export const HOLDINGS_PAGE_SIZE = 40;
export const CHART_COLORS = ["#0f766e", "#0284c7", "#7c3aed", "#d97706", "#be123c", "#475569"];
export const EMPTY_HOLDINGS: Holding[] = [];
