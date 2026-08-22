import type { AccountType } from "@/app/lib/constants";
import type {
  BaseAmount,
  EurAmount,
  PercentString,
  PriceString,
  QuantityString,
} from "@/app/lib/types/money-brands";

export type {
  BaseAmount,
  EurAmount,
  PercentString,
  PriceString,
  QuantityString,
} from "@/app/lib/types/money-brands";

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
  /** Enveloppe fiscale / stockage — union ACCOUNT_TYPES */
  accountType: AccountType;
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
  /** Position adossée à un protocole DeFi — exclue de la vue Comptant. */
  isDefiPosition?: boolean;
  /** Position adossée à un NFT — exclue de la vue Comptant. */
  isNftItem?: boolean;
  quantity: QuantityString;
  avgCostEur: EurAmount;
  costBasisEur: EurAmount;
  currentPriceEur: PriceString;
  currentPriceNative: PriceString;
  marketValueEur: EurAmount;
  marketValueBase: BaseAmount;
  costBasisBase: BaseAmount;
  unrealizedPnlEur: EurAmount;
  unrealizedPnlBase: BaseAmount;
  unrealizedPnlPct: PercentString;
  priceSource: string | null;
  priceStatus: string | null;
  lastUpdatedAt: string | null;
  acquisitionFeesEur?: EurAmount;
  acquisitionFeesBase?: BaseAmount;
  passiveIncomeEur?: EurAmount;
  passiveIncomeBase?: BaseAmount;
  breakEvenEur?: EurAmount;
  breakEvenBase?: BaseAmount;
  allocationPct?: PercentString;
  allocationPctOfClass?: PercentString;
  stopLoss?: string | null;
  tp1?: string | null;
  tp2?: string | null;
  tp3?: string | null;
  tp4?: string | null;
  /** True si des niveaux SL/TP existent sur une jambe non-principale (multi-plateforme). */
  hasSecondaryLevels?: boolean;
  /** Ligne épinglée dans la watchlist du tableau de bord. */
  watchlisted?: boolean;
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
  /**
   * Positions à levier / dérivés — futures crypto pour l'instant.
   *
   * Onglet à part et non un sous-onglet de `crypto` : une position à levier
   * n'est pas un actif détenu mais un pari collatéralisé par une marge. Elle
   * ne pèse au patrimoine ni par sa taille ni par son notionnel, seulement
   * par marge + P&L latent. Elle n'a donc pas sa place à côté du comptant,
   * de la DeFi et des NFT, qui sont tous trois des actifs détenus valorisés
   * depuis le journal.
   */
  | "trading"
  /**
   * Saisie des contrats d'assurance-vie et de leurs supports.
   *
   * Distinct de `av`, qui est l'enveloppe côté Positions : celui-ci est un
   * écran de saisie, comme `banques`, là où `av` filtre des positions déjà
   * enregistrées.
   */
  | "assurance-vie"
  /**
   * Comptes titres — PEA, PEA-PME et compte-titres ordinaire.
   *
   * Onglet de premier niveau et non un filtre d'enveloppe, pour la même raison
   * que l'immobilier et la crypto avant lui : un PEA porte une date
   * d'ouverture, un plafond de versement et un régime d'imposition qui lui est
   * propre — une vente interne n'y est pas un fait générateur, seul le retrait
   * l'est. Le tableau Positions filtré ne montrait que la valeur, jamais rien
   * de tout cela.
   */
  | "securities"
  | "fiscal";

export type PlatformRow = {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  cashEur: string;
  cashBase: string;
  /** Cash Banques/Livrets rattaché par nom (hors ledger APPORT) */
  bankPocketCashEur?: string;
  bankPocketCashBase?: string;
  logoUrl: string | null;
  logoKey?: string | null;
  walletAddress?: string | null;
  /**
   * Le secret n'est jamais renvoyé au client (voir getPlatformCashBalances) —
   * seul ce booléen indique qu'une clé est déjà enregistrée côté serveur.
   */
  hasWalletApiKey?: boolean;
  notes?: string | null;
  /** Positions titres ouvertes (qty > 0) */
  positionCount?: number;
  positionsValueEur?: string;
  positionsValueBase?: string;
  /** Cash + titres */
  totalValueEur?: string;
  totalValueBase?: string;
  /** P&L latent des positions ouvertes (hors cash) — marché vs coût de revient */
  unrealizedPnlEur?: string;
  unrealizedPnlBase?: string;
  unrealizedPnlPct?: string;
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

  /** Valeur brute des actifs — métrique par défaut de la courbe. */
  grossAssetsBase?: number;
  /** `grossAssets - liabilities`. */
  netWorthBase?: number;
  liabilitiesBase?: number;
  /** Capital externe entré (net) ce jour-là — jamais compté en performance. */
  externalFlowsBase?: number;
  /** Résultat du jour, flux neutralisés. */
  investmentPerformanceBase?: number;

  securitiesBase?: number;
  cryptoBase?: number;
  realEstateBase?: number;
  lifeInsuranceBase?: number;
  alternativesBase?: number;
  employeeSavingsBase?: number;
  otherAssetsBase?: number;

  /** `EXACT` | `ESTIMATED` | `MISSING`. */
  status?: "EXACT" | "ESTIMATED" | "MISSING";
  /** Compartiments non exacts ce jour-là. */
  estimatedComponents?: string[];
  /** Au moins un compartiment estimé ce jour-là. */
  estimated?: boolean;
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
  // `immobilier` n'est plus un clone filtré de Positions : l'onglet dédié
  // rend sa propre vue. Le mapping vers l'enveloppe IMMOBILIER est conservé
  // dans TAB_TO_ACCOUNT_TYPE, encore utilisé pour filtrer les positions
  // affichées à l'intérieur de cet onglet.
  //
  // `crypto` reste ici (contrairement à `immobilier`) : son sous-onglet
  // Comptant montre justement le tableau Positions filtré — c'est DeFi/NFT/
  // Futures qui le masquent, via la condition posée dans portfolio-app.tsx.
  "crypto",
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
  { id: "holdings", label: "Portefeuille" },
  // Libellé volontairement explicite plutôt que « Titres » : les deux sigles
  // parlent immédiatement, là où « Titres » demande un temps de traduction.
  { id: "securities", label: "PEA & CTO" },
  { id: "banques", label: "Banques" },
  // Catégorie à part entière, au même rang que Banques ou Épargne salariale :
  // un bien porte un usage, un régime fiscal, un dispositif, un bail et une
  // dette. Le réduire à un filtre d'enveloppe du tableau Positions n'en
  // montrait que la valeur.
  { id: "immobilier", label: "Immobilier" },
  // Même raisonnement : comptant, DeFi et NFT sont trois lectures différentes
  // du même patrimoine, avec leur propre vue d'ensemble et leurs propres flux
  // de saisie — plus un simple filtre d'enveloppe.
  { id: "crypto", label: "Cryptos" },
  { id: "epargne-salariale", label: "Épargne Salariale" },
  { id: "alternatifs", label: "Actifs Alternatifs" },
  { id: "trading", label: "Trading" },
  { id: "transactions", label: "Opérations" },
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
  { id: "av", label: "Assurance-Vie", short: "AV" },
  // `immobilier`, `crypto` et désormais les comptes titres (`securities`, sous
  // le libellé « PEA & CTO ») sont passés en navigation primaire : les laisser
  // aussi ici afficherait deux entrées pour la même vue.
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
  "trading",
  "securities",
  "fiscal",
] as const;

export function isMainTab(v: string): v is MainTab {
  return (MAIN_TAB_IDS as readonly string[]).includes(v);
}

export const TAB_STORAGE_KEY = "patrimo.mainTab";

export const HOLDINGS_PAGE_SIZE = 40;
export const CHART_COLORS = ["#0f766e", "#0284c7", "#7c3aed", "#d97706", "#be123c", "#475569"];

/** Luminance relative WCAG d'une couleur `#rrggbb`. */
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const chan = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

function contrastWith(hex: string, luminance: number): number {
  const l = relativeLuminance(hex);
  const [hi, lo] = l > luminance ? [l, luminance] : [luminance, l];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Couleur de texte lisible sur un aplat de la palette graphique.
 *
 * Le blanc systématique tombait sous le seuil WCAG AA (4.5:1) sur les teintes
 * claires de la palette — 3.19:1 sur l'ambre `#d97706`, 4.1:1 sur le bleu
 * `#0284c7`. On retient donc, entre blanc et encre foncée, celle qui contraste
 * le mieux avec le fond ; le calcul suit la palette si elle évolue.
 */
export function readableInkOn(background: string): "#ffffff" | "#0b1220" {
  const white = contrastWith("#ffffff", relativeLuminance(background));
  const ink = contrastWith("#0b1220", relativeLuminance(background));
  return ink > white ? "#0b1220" : "#ffffff";
}
export const EMPTY_HOLDINGS: Holding[] = [];

/**
 * Libellé lisible d'une source de cours.
 *
 * `priceSource` porte un jeton interne (`seed`, `yahoo`, `coingecko`…) qui était
 * affiché brut, en capitales, sous chaque cours du tableau Positions : « SEED »,
 * « COINGECKO ». Du vocabulaire de développeur exposé sur l'écran le plus
 * consulté. On mappe donc vers le nom réel du fournisseur, et on laisse passer
 * tel quel — simplement capitalisé — toute source inconnue, pour ne jamais
 * masquer une provenance.
 */
const PRICE_SOURCE_LABELS: Record<string, string> = {
  seed: "Démo",
  yahoo: "Yahoo Finance",
  "yahoo-finance": "Yahoo Finance",
  binance: "Binance",
  coingecko: "CoinGecko",
  zerion: "Zerion",
  solana: "Solana RPC",
  monero: "Monero",
  mock: "Simulé",
  manual: "Saisie manuelle",
  "coût": "Au coût",
  cout: "Au coût",
  cost: "Au coût",
};

export function priceSourceLabel(source: string | null | undefined): string {
  const raw = (source ?? "").trim();
  if (!raw) return "Source inconnue";
  const hit = PRICE_SOURCE_LABELS[raw.toLowerCase()];
  if (hit) return hit;
  // Source non répertoriée : capitaliser sans crier.
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}
