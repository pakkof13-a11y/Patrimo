/**
 * Vocabulaire métier du module Crypto.
 *
 * Séparé de `app/lib/constants.ts` pour la même raison que l'immobilier : ces
 * listes ne concernent qu'un module, et les mêler aux classes d'actifs
 * générales rendrait le fichier central illisible.
 */

/**
 * Nature d'une position DeFi.
 *
 * Ce qui distingue ces natures n'est pas cosmétique : une position `BORROWING`
 * est une **dette** (elle se soustrait), toutes les autres sont des dépôts (ils
 * s'ajoutent). C'est `isDebtPosition` qui porte cette règle, et rien d'autre ne
 * doit la ré-implémenter.
 */
export const DEFI_POSITION_TYPES = {
  STAKING: "Staking",
  LIQUID_STAKING: "Staking liquide",
  LENDING: "Prêt (dépôt)",
  BORROWING: "Emprunt",
  LP: "Liquidité (LP / AMM)",
  YIELD_FARMING: "Yield farming",
  VAULT: "Vault / stratégie",
  RESTAKING: "Restaking",
  RWA: "Actif réel tokenisé",
  LOCKED: "Verrouillé / vesting",
  REWARDS: "Récompenses à réclamer",
  OTHER: "Autre",
} as const;

export type DefiPositionType = keyof typeof DEFI_POSITION_TYPES;

/**
 * Seul type de position qui représente une dette.
 *
 * Isolé dans une constante plutôt qu'écrit en dur dans les agrégats : une
 * position empruntée comptée comme un dépôt gonflerait le patrimoine du montant
 * exact de ce qu'on doit — l'erreur serait doublée, pas neutre.
 */
export const DEBT_POSITION_TYPES: readonly DefiPositionType[] = ["BORROWING"];

export function isDebtPosition(positionType: string): boolean {
  return (DEBT_POSITION_TYPES as readonly string[]).includes(positionType);
}

export function defiPositionTypeLabel(value: string): string {
  return DEFI_POSITION_TYPES[value as DefiPositionType] ?? value;
}

/**
 * Correspondance des `position_type` renvoyés par Zerion.
 *
 * Zerion décrit une position par un couple (position_type, protocole). Son
 * vocabulaire est plus pauvre que le nôtre — « deposit » recouvre aussi bien un
 * prêt Aave qu'un dépôt en vault — d'où l'affinage par protocole dans
 * `refineDefiType`.
 */
const ZERION_TYPE_MAP: Record<string, DefiPositionType> = {
  staked: "STAKING",
  deposit: "LENDING",
  loan: "BORROWING",
  borrow: "BORROWING",
  locked: "LOCKED",
  reward: "REWARDS",
  rewards: "REWARDS",
  claimable: "REWARDS",
};

/** Protocoles dont les dépôts sont en réalité du staking liquide. */
const LIQUID_STAKING_PROTOCOLS =
  /\block\b|lido|rocket\s?pool|frax\s?eth|coinbase\s?wrapped|mantle\s?staked|jito|marinade|stader|swell|ether\.?fi/i;

/** Protocoles de restaking — distincts du staking simple (risque cumulé). */
const RESTAKING_PROTOCOLS = /eigen\s?layer|eigen|symbiotic|karak|renzo|kelp/i;

/** Protocoles d'AMM / pools de liquidité. */
const LP_PROTOCOLS =
  /uniswap|curve|balancer|sushi|pancake|velodrome|aerodrome|raydium|orca|camelot|quickswap|trader\s?joe/i;

/** Protocoles de vault / stratégie automatisée. */
const VAULT_PROTOCOLS = /yearn|beefy|convex|aura|morpho|gearbox|idle|harvest/i;

/**
 * Type de position DeFi à partir de ce que Zerion renvoie.
 *
 * Le protocole prime sur `position_type` quand il est sans ambiguïté : Zerion
 * annonce un stETH Lido comme un simple `deposit`, ce qui le rangerait avec les
 * prêts Aave alors que le risque, le rendement et la liquidité n'ont rien à
 * voir.
 */
export function refineDefiType(
  zerionPositionType: string | null | undefined,
  protocol: string | null | undefined,
  hasSecondAsset = false
): DefiPositionType {
  const raw = (zerionPositionType || "").toLowerCase().trim();
  const proto = protocol || "";

  // Une dette reste une dette quel que soit le protocole : ne jamais laisser
  // l'affinage transformer un emprunt en dépôt.
  const base = ZERION_TYPE_MAP[raw];
  if (base === "BORROWING") return "BORROWING";
  if (base === "REWARDS") return "REWARDS";

  if (RESTAKING_PROTOCOLS.test(proto)) return "RESTAKING";
  if (LIQUID_STAKING_PROTOCOLS.test(proto)) return "LIQUID_STAKING";
  // Deux actifs engagés = pool de liquidité, même si Zerion dit « deposit ».
  if (hasSecondAsset || LP_PROTOCOLS.test(proto)) return "LP";
  if (VAULT_PROTOCOLS.test(proto)) return "VAULT";

  return base ?? "OTHER";
}

/**
 * Catégorie d'un actif crypto — sert au regroupement, jamais aux calculs.
 */
export const CRYPTO_CATEGORIES = {
  L1: "Layer 1",
  L2: "Layer 2",
  STABLECOIN: "Stablecoin",
  DEFI_TOKEN: "Token DeFi",
  LST: "Staking liquide",
  MEME: "Meme",
  NFT: "NFT",
  OTHER: "Autre",
} as const;

export type CryptoCategory = keyof typeof CRYPTO_CATEGORIES;

export function cryptoCategoryLabel(value: string): string {
  return CRYPTO_CATEGORIES[value as CryptoCategory] ?? value;
}

/** Stablecoins reconnus — pilote le badge et l'allocation « part stable ». */
const STABLECOIN_TICKERS = new Set([
  "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "FRAX", "LUSD", "GUSD",
  "SUSD", "USDD", "PYUSD", "FDUSD", "USDE", "CRVUSD", "GHO", "EURC", "EURT",
  "EURS", "AGEUR", "USDS", "USD0", "RLUSD",
]);

const L1_TICKERS = new Set([
  "BTC", "ETH", "SOL", "ADA", "AVAX", "DOT", "ATOM", "NEAR", "APT", "SUI",
  "TON", "TRX", "XRP", "LTC", "BCH", "XMR", "ALGO", "HBAR", "ICP", "FTM",
  "SEI", "TIA", "INJ", "KAS", "EGLD",
]);

const L2_TICKERS = new Set([
  "ARB", "OP", "MATIC", "POL", "STRK", "IMX", "MNT", "METIS", "BLAST",
  "ZK", "SCR", "MANTA", "LRC",
]);

const LST_TICKERS = new Set([
  "STETH", "WSTETH", "RETH", "CBETH", "SFRXETH", "FRXETH", "METH", "EZETH",
  "WEETH", "RSETH", "JITOSOL", "MSOL", "BSOL", "JUPSOL", "OSETH", "SWETH",
]);

const DEFI_TICKERS = new Set([
  "UNI", "AAVE", "CRV", "MKR", "SNX", "COMP", "LDO", "SUSHI", "BAL", "YFI",
  "CVX", "1INCH", "DYDX", "GMX", "PENDLE", "ENA", "MORPHO", "EIGEN", "JUP",
  "RAY", "ORCA", "SPELL", "FXS",
]);

const MEME_TICKERS = new Set([
  "DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "BRETT", "POPCAT", "MEW",
  "TURBO", "MOG", "NEIRO", "SPX", "GOAT", "PNUT", "FARTCOIN", "TRUMP",
]);

export function isStablecoinTicker(ticker: string | null | undefined): boolean {
  return STABLECOIN_TICKERS.has((ticker || "").trim().toUpperCase());
}

/**
 * Catégorie déduite du ticker.
 *
 * Volontairement une simple table : une classification « intelligente » se
 * tromperait silencieusement, alors qu'une table se corrige d'une ligne. Tout
 * ce qui n'est pas reconnu tombe en `OTHER` plutôt que d'être deviné.
 */
export function categorizeTicker(
  ticker: string | null | undefined
): CryptoCategory {
  const t = (ticker || "").trim().toUpperCase();
  if (!t) return "OTHER";
  if (STABLECOIN_TICKERS.has(t)) return "STABLECOIN";
  if (LST_TICKERS.has(t)) return "LST";
  if (L2_TICKERS.has(t)) return "L2";
  if (L1_TICKERS.has(t)) return "L1";
  if (DEFI_TICKERS.has(t)) return "DEFI_TOKEN";
  if (MEME_TICKERS.has(t)) return "MEME";
  return "OTHER";
}

/**
 * Seuils d'alerte sur un prêt collatéralisé.
 *
 * Le health factor est le rapport entre la valeur liquidable du collatéral et
 * la dette : en dessous de 1, la position est liquidable. Les paliers sont
 * volontairement conservateurs — une alerte qui se déclenche à 1,05 arrive trop
 * tard pour agir.
 */
export const HEALTH_FACTOR_CRITICAL = 1.3;
export const HEALTH_FACTOR_WARNING = 1.8;
/** Au-delà, la position consomme l'essentiel de sa capacité d'emprunt. */
export const LTV_WARNING_PCT = 70;

export type RiskLevel = "CRITICAL" | "WARNING" | "OK";

export function healthFactorRisk(
  healthFactor: number | null | undefined
): RiskLevel | null {
  if (healthFactor == null || !Number.isFinite(healthFactor)) return null;
  if (healthFactor < HEALTH_FACTOR_CRITICAL) return "CRITICAL";
  if (healthFactor < HEALTH_FACTOR_WARNING) return "WARNING";
  return "OK";
}

export function ltvRisk(ltvPct: number | null | undefined): RiskLevel | null {
  if (ltvPct == null || !Number.isFinite(ltvPct)) return null;
  return ltvPct > LTV_WARNING_PCT ? "WARNING" : "OK";
}
