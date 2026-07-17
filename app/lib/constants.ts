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
  FRAIS: "Frais / Commission",
  APPORT: "Apport cash banque",
  RETRAIT: "Retrait cash banque",
  TRANSFERT_CASH: "Transfert cash",
  TRANSFERT_TITRE: "Transfert titres",
  /** Ratio dans quantité (2 = doublement de titres, CUMP / 2). */
  SPLIT: "Split / division",
} as const;

export type TransactionTypeLabel = keyof typeof TRANSACTION_TYPES;

export const PRICE_PROVIDERS = {
  FINNHUB: "Finnhub",
  YAHOO: "Yahoo Finance",
  COINGECKO: "CoinGecko",
  MANUAL: "Valorisation manuelle",
} as const;

/** Banks offered in comptes courants dropdown */
export const BANK_OPTIONS = [
  "Revolut",
  "Hello Bank",
  "N26",
  "BoursoBank",
  "La Banque Postale",
  "CIC",
  "Nickel",
  "Monabanq",
  "Sumeria",
  "BNP Paribas",
  "Société Générale",
  "Crédit Agricole",
  "Caisse d'Épargne",
  "Banque Populaire",
  "LCL",
  "Crédit Mutuel",
  "Fortuneo",
  "BforBank",
  "Autre",
] as const;

/** Prêteurs / banques pour l'onglet Passifs (crédits) — uniques par key, tri A–Z sur name */
const LIABILITY_LENDER_SEED: { key: string; name: string }[] = [
  { key: "BANQUE_POPULAIRE", name: "Banque Populaire" },
  { key: "BFORBANK", name: "BforBank" },
  { key: "BNP_PARIBAS", name: "BNP Paribas" },
  { key: "BOURSOBANK", name: "BoursoBank" },
  { key: "CAISSE_EPARGNE", name: "Caisse d'Épargne" },
  { key: "CARREFOUR_BANQUE", name: "Carrefour Banque" },
  { key: "CCF", name: "CCF" },
  { key: "CETELEM", name: "Cetelem" },
  { key: "CIC", name: "CIC" },
  { key: "COFIDIS", name: "Cofidis" },
  { key: "CREDIT_AGRICOLE", name: "Crédit Agricole" },
  { key: "CREDIT_FONCIER", name: "Crédit Foncier" },
  { key: "CREDIT_MUTUEL", name: "Crédit Mutuel" },
  { key: "FLOA_BANK", name: "FLOA Bank" },
  { key: "FORTUNEO", name: "Fortuneo" },
  { key: "FRANFINANCE", name: "Franfinance" },
  { key: "HELLO_BANK", name: "Hello Bank!" },
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
 * 90 s : bon compromis fraîcheur vs charge providers / multi-onglets.
 * Voir docs/perf-refresh.md
 */
export const PRICE_AUTO_REFRESH_MS = 90_000;

/** Pause de base après échecs consécutifs (backoff exponentiel plafonné). */
export const PRICE_REFRESH_BACKOFF_BASE_MS = 60_000;
export const PRICE_REFRESH_BACKOFF_MAX_MS = 10 * 60_000;
