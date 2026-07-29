export const ASSET_CLASSES = {
  ACTIONS: "Actions / ETF",
  CRYPTO: "Cryptomonnaies",
  IMMOBILIER: "Immobilier",
  OBLIGATIONS: "Obligations",
  CASH: "Liquidités / Cash",
  AUTRE: "Autre",
} as const;

export type AssetClass = keyof typeof ASSET_CLASSES;

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  ACTIONS: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CRYPTO: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  IMMOBILIER: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  OBLIGATIONS: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  CASH: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  AUTRE: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

/**
 * Teintes des classes d'actifs pour les graphiques (Recharts attend des
 * couleurs CSS, pas des classes Tailwind). Les tons reprennent ceux des badges
 * `ASSET_CLASS_COLORS` ci-dessus, à une saturation lisible sur fond clair
 * comme sur fond sombre, pour qu'une classe garde la même identité visuelle
 * d'un écran à l'autre.
 *
 * Une exception assumée : le badge « Obligations » est ardoise, mais deux gris
 * voisins dans une même pile de colonnes ne se distinguent pas (dE ≈ 18 avec
 * « Autre », sous le seuil où l'œil sépare deux teintes avec certitude). La
 * classe passe donc au cyan sur les graphiques, ce qui porte la paire la plus
 * proche de la palette à dE ≈ 28.
 */
export const ASSET_CLASS_CHART_COLORS: Record<AssetClass, string> = {
  ACTIONS: "#2563eb",
  CRYPTO: "#d97706",
  IMMOBILIER: "#7c3aed",
  OBLIGATIONS: "#0e7490",
  CASH: "#059669",
  AUTRE: "#94a3b8",
};

/** Couleur de graphique d'une classe, avec repli sur « Autre ». */
export function assetClassChartColor(assetClass: string): string {
  return (
    ASSET_CLASS_CHART_COLORS[assetClass as AssetClass] ??
    ASSET_CLASS_CHART_COLORS.AUTRE
  );
}

/** Libellé d'une classe, avec repli sur le code brut. */
export function assetClassLabel(assetClass: string): string {
  return ASSET_CLASSES[assetClass as AssetClass] ?? assetClass;
}

/** Fiscal / storage envelope for holdings filtering (tabs + dropdown Positions) */
export const ACCOUNT_TYPES = {
  CTO: "Compte-Titres",
  PEA: "PEA",
  AV: "Assurance-Vie",
  CRYPTO: "Cryptomonnaies",
  IMMOBILIER: "Immobilier",
  CFD: "CFD",
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

/** Account types that have an envelope cash pocket panel */
export const ENVELOPE_CASH_TYPES = ["CTO", "PEA", "AV"] as const;

export const PLATFORM_TYPES = {
  COURTIER: "Courtier titres",
  ASSURANCE_VIE: "Assurance-vie",
  EXCHANGE_CRYPTO: "Exchange crypto",
  BANQUE: "Banque",
  BLOCKCHAIN: "Blockchain / wallet",
  PORTEFEUILLE_HARDWARE: "Portefeuille hardware",
  NOTAIRE_IMMOBILIER: "Notaire / immobilier",
  BROKER_CFD: "Courtier CFD",
  AUTRE: "Autre",
} as const;

export type PlatformType = keyof typeof PLATFORM_TYPES;

export const TRANSACTION_TYPES = {
  ACHAT: "Achat",
  VENTE: "Vente",
  DIVIDENDE: "Dividende",
  COUPON: "Coupon",
  LOYER: "Loyer perçu",
  INTERET: "Intérêts",
  /** Réception gratuite (staking…) — +qty, coût 0, pas un achat. */
  REWARD: "Staking / reward",
  /** Airdrop token — +qty, coût 0 (même ledger que REWARD). */
  AIRDROP: "Airdrop",
  FRAIS: "Frais / Commission",
  APPORT: "Dépôt",
  RETRAIT: "Retrait",
  TRANSFERT_CASH: "Transfert cash",
  TRANSFERT_TITRE: "Transfert titres",
  /** Ratio dans quantité (2 = doublement de titres, CUMP / 2). */
  SPLIT: "Split / division",
  /** Travaux immobilisés : s'ajoutent au coût de revient, pas à la quantité. */
  TRAVAUX: "Travaux capitalisés",
} as const;

export type TransactionTypeLabel = keyof typeof TRANSACTION_TYPES;

export const PRICE_PROVIDERS = {
  FINNHUB: "Finnhub",
  YAHOO: "Yahoo Finance",
  COINGECKO: "CoinGecko",
  MANUAL: "Valorisation manuelle",
} as const;

/**
 * Banques / fintechs — onglet comptes courants.
 * N26 uniquement ici (pas de PEA/CTO → hors PLATFORM_PRESETS).
 * Banques PEA/CTO restent listées pour les liquidités (doublon intentionnel
 * avec le catalogue plateformes, usages distincts).
 * Tri alphabétique + « Autre » en fin.
 */
export const BANK_OPTIONS = [
  "Banque Populaire",
  "BforBank",
  "BNP Paribas",
  "BoursoBank",
  "Caisse d'Épargne",
  "CIC",
  "Crédit Agricole",
  "Crédit Mutuel",
  "Fortuneo",
  "Hello Bank",
  "La Banque Postale",
  "LCL",
  "Monabanq",
  "N26",
  "Nickel",
  "Revolut",
  "Société Générale",
  "Sumeria",
  "Autre",
] as const;

/**
 * Prêteurs / banques pour l'onglet Passifs (crédits uniquement).
 * Ne remonte PAS dans PLATFORM_PRESETS.
 * Uniques par key, tri A–Z sur name.
 */
const LIABILITY_LENDER_SEED: { key: string; name: string }[] = [
  { key: "BANQUE_POPULAIRE", name: "Banque Populaire" },
  { key: "BFORBANK", name: "BforBank" },
  { key: "BNP_PARIBAS", name: "BNP Paribas" },
  { key: "BOURSOBANK", name: "BoursoBank" },
  { key: "BPIFRANCE", name: "Bpifrance" },
  { key: "CAISSE_EPARGNE", name: "Caisse d'Épargne" },
  { key: "CARREFOUR_BANQUE", name: "Carrefour Banque" },
  { key: "CCF", name: "CCF" },
  { key: "CETELEM", name: "Cetelem" },
  { key: "CIC", name: "CIC" },
  { key: "COFIDIS", name: "Cofidis" },
  { key: "CREDIT_AGRICOLE", name: "Crédit Agricole" },
  { key: "CREDIT_FONCIER", name: "Crédit Foncier" },
  { key: "CREDIT_MUTUEL", name: "Crédit Mutuel" },
  { key: "DOMOFINANCE", name: "Domofinance" },
  { key: "FLOA_BANK", name: "FLOA Bank" },
  { key: "FORTUNEO", name: "Fortuneo" },
  { key: "FRANFINANCE", name: "Franfinance" },
  { key: "GE_MONEY_BANK", name: "GE Money Bank" },
  { key: "HELLO_BANK", name: "Hello Bank!" },
  { key: "HSBC_FRANCE", name: "HSBC France" },
  { key: "ING", name: "ING" },
  { key: "LA_BANQUE_POSTALE", name: "La Banque Postale" },
  { key: "LCL", name: "LCL" },
  { key: "MONABANQ", name: "Monabanq" },
  { key: "ONEY", name: "Oney" },
  { key: "REVOLUT", name: "Revolut" },
  { key: "SOCIETE_GENERALE", name: "Société Générale" },
  { key: "SOFINCO", name: "Sofinco" },
  { key: "YOUNITED_CREDIT", name: "Younited Credit" },
];

function buildLiabilityLenders(): { key: string; name: string }[] {
  const byKey = new Map<string, { key: string; name: string }>();
  for (const l of LIABILITY_LENDER_SEED) {
    if (byKey.has(l.key)) continue; // no overwrite / no duplicate key
    byKey.set(l.key, l);
  }
  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
  );
}

export const LIABILITY_LENDERS = buildLiabilityLenders();

/** Noms seuls pour les <select> Passifs (+ Autre en fin) */
export const LIABILITY_LENDER_OPTIONS = [
  ...LIABILITY_LENDERS.map((l) => l.name),
  "Autre",
] as const;

/** Catégorie de passif — regroupement d'affichage, indépendant du calcul. */
export const LIABILITY_CATEGORIES = [
  "IMMOBILIER",
  "AUTO",
  "CONSOMMATION",
  "DETTE_PRIVEE",
  "PROFESSIONNEL",
  "AUTRE",
] as const;

export const LIABILITY_CATEGORY_LABELS: Record<
  (typeof LIABILITY_CATEGORIES)[number],
  string
> = {
  IMMOBILIER: "Immobilier",
  AUTO: "Auto",
  CONSOMMATION: "Consommation",
  DETTE_PRIVEE: "Dette privée",
  PROFESSIONNEL: "Professionnel",
  AUTRE: "Autre",
};

export const BUSINESS_TIMEZONE = "Europe/Paris";

/**
 * Identifiants publics par défaut (non secrets) — emails / usernames de bootstrap.
 * Les mots de passe ne sont JAMAIS ici : voir ADMIN_PASSWORD / DEMO_PASSWORD dans .env
 * et `app/lib/env/seed-credentials.ts`.
 */
export const DEMO_EMAIL = "demo@patrimo.fr";
export const DEMO_USERNAME = "demo";

/** SuperUser initial (seed) — username / email publics uniquement */
export const ADMIN_USERNAME = "admin";
export const ADMIN_EMAIL = "admin@patrimo.local";

/**
 * Intervalle auto-refresh des prix (onglet leader, page visible uniquement).
 * 60 s : fraîcheur correcte vs charge providers / multi-onglets.
 * Voir docs/perf-refresh.md
 */
export const PRICE_AUTO_REFRESH_MS = 60_000;

/** Pause de base après échecs consécutifs (backoff exponentiel plafonné). */
export const PRICE_REFRESH_BACKOFF_BASE_MS = 60_000;
export const PRICE_REFRESH_BACKOFF_MAX_MS = 10 * 60_000;
