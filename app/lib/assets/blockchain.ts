/**
 * Blockchain UI — classification affichage / regroupement (hors ledger).
 * Dérivée de la plateforme (type, logoKey, nom) + notes / providerSymbol actif.
 */

export const BLOCKCHAIN_KEYS = [
  "ethereum",
  "solana",
  "bitcoin",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
  "bnb",
  "avalanche",
  "cosmos",
  "near",
  "polkadot",
  "tron",
  "ripple",
  "litecoin",
  "dogecoin",
  "monero",
  "fantom",
  "zksync",
  "linea",
  "scroll",
  "mantle",
  "blast",
  "gnosis",
  "other_chain",
  "exchange",
  "unknown",
] as const;

export type BlockchainKey = (typeof BLOCKCHAIN_KEYS)[number];

export const BLOCKCHAIN_LABELS: Record<BlockchainKey, string> = {
  ethereum: "Ethereum",
  solana: "Solana",
  bitcoin: "Bitcoin",
  base: "Base",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  bnb: "BNB Chain",
  avalanche: "Avalanche",
  cosmos: "Cosmos",
  near: "Near",
  polkadot: "Polkadot",
  tron: "Tron",
  ripple: "XRP Ledger",
  litecoin: "Litecoin",
  dogecoin: "Dogecoin",
  monero: "Monero",
  fantom: "Fantom",
  zksync: "zkSync",
  linea: "Linea",
  scroll: "Scroll",
  mantle: "Mantle",
  blast: "Blast",
  gnosis: "Gnosis",
  other_chain: "Autre chaîne",
  exchange: "Exchange / courtier",
  unknown: "Non identifiée",
};

/** Ordre d’affichage des groupes (exchanges + unknown en fin). */
export const BLOCKCHAIN_ORDER: readonly BlockchainKey[] = [
  "ethereum",
  "solana",
  "bitcoin",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
  "bnb",
  "avalanche",
  "cosmos",
  "near",
  "polkadot",
  "tron",
  "ripple",
  "litecoin",
  "dogecoin",
  "monero",
  "fantom",
  "zksync",
  "linea",
  "scroll",
  "mantle",
  "blast",
  "gnosis",
  "other_chain",
  "exchange",
  "unknown",
];

const PRESET_TO_CHAIN: Record<string, BlockchainKey> = {
  ETHEREUM: "ethereum",
  SOLANA: "solana",
  BITCOIN: "bitcoin",
  BASE: "base",
  POLYGON: "polygon",
  ARBITRUM: "arbitrum",
  OPTIMISM: "optimism",
  BNB_CHAIN: "bnb",
  BSC: "bnb",
  AVALANCHE: "avalanche",
  COSMOS: "cosmos",
  NEAR: "near",
  POLKADOT: "polkadot",
  TRON: "tron",
  RIPPLE: "ripple",
  LITECOIN: "litecoin",
  DOGECOIN: "dogecoin",
  MONERO: "monero",
  FANTOM: "fantom",
  ZKSYNC: "zksync",
  LINEA: "linea",
  SCROLL: "scroll",
  MANTLE: "mantle",
  BLAST: "blast",
  GNOSIS: "gnosis",
  BINANCE: "exchange",
  COINBASE: "exchange",
  KRAKEN: "exchange",
  CRYPTOCOM: "exchange",
  BITSTAMP: "exchange",
  BITFINEX: "exchange",
  OKX: "exchange",
  BYBIT: "exchange",
  KUCOIN: "exchange",
  GATEIO: "exchange",
  REVOLUT: "exchange",
};

/** Zerion / notes chain=… → clé UI */
const CHAIN_ID_ALIASES: Record<string, BlockchainKey> = {
  ethereum: "ethereum",
  eth: "ethereum",
  mainnet: "ethereum",
  solana: "solana",
  sol: "solana",
  bitcoin: "bitcoin",
  btc: "bitcoin",
  base: "base",
  "polygon-pos": "polygon",
  polygon: "polygon",
  matic: "polygon",
  "arbitrum-one": "arbitrum",
  arbitrum: "arbitrum",
  "optimistic-ethereum": "optimism",
  optimism: "optimism",
  "binance-smart-chain": "bnb",
  bsc: "bnb",
  bnb: "bnb",
  "avalanche-c": "avalanche",
  avalanche: "avalanche",
  avax: "avalanche",
  cosmos: "cosmos",
  near: "near",
  polkadot: "polkadot",
  tron: "tron",
  xrp: "ripple",
  ripple: "ripple",
  litecoin: "litecoin",
  dogecoin: "dogecoin",
  monero: "monero",
  fantom: "fantom",
  zksync: "zksync",
  "zksync-era": "zksync",
  linea: "linea",
  scroll: "scroll",
  mantle: "mantle",
  blast: "blast",
  gnosis: "gnosis",
  xdai: "gnosis",
};

export function blockchainLabel(key: string | null | undefined): string {
  if (!key) return BLOCKCHAIN_LABELS.unknown;
  const k = key.toLowerCase() as BlockchainKey;
  return BLOCKCHAIN_LABELS[k] ?? key;
}

export function isBlockchainKey(v: unknown): v is BlockchainKey {
  return (
    typeof v === "string" &&
    (BLOCKCHAIN_KEYS as readonly string[]).includes(v)
  );
}

/**
 * Résout la blockchain / lieu de détention pour l’UI.
 */
export function resolveBlockchainKey(input: {
  platformType?: string | null;
  platformLogoKey?: string | null;
  platformName?: string | null;
  platformSubtype?: string | null;
  assetNotes?: string | null;
  providerSymbol?: string | null;
  accountType?: string | null;
  assetClass?: string | null;
}): BlockchainKey {
  const isCrypto =
    (input.accountType || "").toUpperCase() === "CRYPTO" ||
    (input.assetClass || "").toUpperCase() === "CRYPTO";

  // Notes Zerion : chain=ethereum
  const notes = input.assetNotes || "";
  const chainMatch = notes.match(/chain\s*=\s*([a-z0-9_-]+)/i);
  if (chainMatch?.[1]) {
    const alias = CHAIN_ID_ALIASES[chainMatch[1].toLowerCase()];
    if (alias) return alias;
  }

  // providerSymbol Zerion : zr:ethereum:0x…
  const ps = (input.providerSymbol || "").toLowerCase();
  if (ps.startsWith("zr:")) {
    const part = ps.split(":")[1];
    if (part) {
      const alias = CHAIN_ID_ALIASES[part];
      if (alias) return alias;
    }
  }

  const logo = (input.platformLogoKey || "").trim().toUpperCase();
  if (logo && PRESET_TO_CHAIN[logo]) return PRESET_TO_CHAIN[logo];

  const pType = (input.platformType || "").toUpperCase();
  if (pType === "EXCHANGE_CRYPTO" || pType === "EXCHANGE") {
    return isCrypto ? "exchange" : "unknown";
  }

  // Nom plateforme
  const name = (input.platformName || "").toLowerCase();
  for (const [alias, key] of Object.entries(CHAIN_ID_ALIASES)) {
    if (name.includes(alias.replace(/-/g, " ")) || name.includes(alias)) {
      return key;
    }
  }
  if (
    /binance|coinbase|kraken|bybit|okx|kucoin|bitstamp|crypto\.com|gate\.io|revolut/.test(
      name
    )
  ) {
    return "exchange";
  }

  if (pType === "BLOCKCHAIN") {
    // Layer 2 hint in subtype not enough — other_chain
    return "other_chain";
  }

  return isCrypto ? "unknown" : "unknown";
}

export type BlockchainGroupable = {
  assetId: string;
  blockchainKey?: string | null;
  marketValueBase: string;
  unrealizedPnlBase: string;
};

export type PositionBlockchainGroup<T extends BlockchainGroupable> = {
  blockchainKey: BlockchainKey;
  label: string;
  positions: T[];
  count: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  weightPct: number | null;
};

function num(s: string | null | undefined): number {
  const n = Number(String(s ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function groupPositionsByBlockchain<T extends BlockchainGroupable>(
  positions: readonly T[]
): PositionBlockchainGroup<T>[] {
  const buckets = new Map<BlockchainKey, T[]>();
  for (const p of positions) {
    const key = isBlockchainKey(p.blockchainKey)
      ? p.blockchainKey
      : ("unknown" as BlockchainKey);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  const scopeTotal = positions.reduce(
    (acc, p) => acc + num(p.marketValueBase),
    0
  );

  const groups: PositionBlockchainGroup<T>[] = [];
  for (const key of BLOCKCHAIN_ORDER) {
    const list = buckets.get(key);
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
      blockchainKey: key,
      label: BLOCKCHAIN_LABELS[key],
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

export type CustodySlice = {
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  blockchainKey: BlockchainKey;
  blockchainLabel: string;
  assetId: string;
  quantity: number;
  marketValueEur: number;
  quantityPct: number;
  valuePct: number;
};

/**
 * Répartition d’un ticker crypto sur plusieurs plateformes / chaînes.
 * Positions déjà filtrées (même ticker, CRYPTO).
 */
export function buildCustodyDistribution(
  rows: Array<{
    assetId: string;
    platformId: string;
    platformName: string;
    platformLogoUrl?: string | null;
    blockchainKey?: string | null;
    quantity: string | number;
    marketValueEur: string | number;
  }>
): CustodySlice[] {
  if (rows.length === 0) return [];
  let totalQty = 0;
  let totalVal = 0;
  const parsed = rows.map((r) => {
    const qty = Number(String(r.quantity).replace(",", "."));
    const val = Number(String(r.marketValueEur).replace(",", "."));
    const q = Number.isFinite(qty) ? Math.max(0, qty) : 0;
    const v = Number.isFinite(val) ? Math.max(0, val) : 0;
    totalQty += q;
    totalVal += v;
    const bk = isBlockchainKey(r.blockchainKey)
      ? r.blockchainKey
      : ("unknown" as BlockchainKey);
    return { r, q, v, bk };
  });

  return parsed
    .map(({ r, q, v, bk }) => ({
      platformId: r.platformId,
      platformName: r.platformName,
      platformLogoUrl: r.platformLogoUrl ?? null,
      blockchainKey: bk,
      blockchainLabel: BLOCKCHAIN_LABELS[bk],
      assetId: r.assetId,
      quantity: q,
      marketValueEur: v,
      quantityPct: totalQty > 0 ? Math.round((q / totalQty) * 1000) / 10 : 0,
      valuePct: totalVal > 0 ? Math.round((v / totalVal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.marketValueEur - a.marketValueEur || b.quantity - a.quantity);
}
