/**
 * Chaînes OpenSea API v2 (path param `chain`).
 * Aligné sur https://docs.opensea.io/reference/get_nfts_by_account
 */

export type OpenSeaChainId =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "avalanche"
  | "zora"
  | "blast"
  | "sei"
  | "ape_chain"
  | "flow"
  | "b3"
  | "soneium"
  | "ronin"
  | "bera_chain"
  | "solana"
  | "shape"
  | "unichain"
  | "gunzilla"
  | "abstract"
  | "animechain"
  | "hyperevm"
  | "somnia"
  | "monad"
  | "hyperliquid"
  | "megaeth"
  | "ink"
  | "robinhood"
  | "stablechain";

export type OpenSeaChain = {
  /** Clé plateforme Patrimo (logoKey / chainPreset) */
  presetKey: string;
  label: string;
  openseaChain: OpenSeaChainId;
};

/** Mapping logoKey / preset → chaîne OpenSea */
const CHAINS: OpenSeaChain[] = [
  { presetKey: "ETHEREUM", label: "Ethereum", openseaChain: "ethereum" },
  { presetKey: "ETH", label: "Ethereum", openseaChain: "ethereum" },
  { presetKey: "BASE", label: "Base", openseaChain: "base" },
  { presetKey: "POLYGON", label: "Polygon", openseaChain: "polygon" },
  { presetKey: "MATIC", label: "Polygon", openseaChain: "polygon" },
  { presetKey: "ARBITRUM", label: "Arbitrum", openseaChain: "arbitrum" },
  { presetKey: "OPTIMISM", label: "Optimism", openseaChain: "optimism" },
  { presetKey: "AVALANCHE", label: "Avalanche", openseaChain: "avalanche" },
  { presetKey: "AVAX", label: "Avalanche", openseaChain: "avalanche" },
  { presetKey: "ZORA", label: "Zora", openseaChain: "zora" },
  { presetKey: "BLAST", label: "Blast", openseaChain: "blast" },
  { presetKey: "SEI", label: "Sei", openseaChain: "sei" },
  { presetKey: "APE", label: "ApeChain", openseaChain: "ape_chain" },
  { presetKey: "APE_CHAIN", label: "ApeChain", openseaChain: "ape_chain" },
  { presetKey: "SOLANA", label: "Solana", openseaChain: "solana" },
  { presetKey: "SOL", label: "Solana", openseaChain: "solana" },
  { presetKey: "RONIN", label: "Ronin", openseaChain: "ronin" },
  { presetKey: "BERA", label: "Berachain", openseaChain: "bera_chain" },
  { presetKey: "BERA_CHAIN", label: "Berachain", openseaChain: "bera_chain" },
  { presetKey: "UNICHAIN", label: "Unichain", openseaChain: "unichain" },
  { presetKey: "ABSTRACT", label: "Abstract", openseaChain: "abstract" },
];

const BY_PRESET = new Map(CHAINS.map((c) => [c.presetKey, c]));
const VALID_OPENSEA = new Set(CHAINS.map((c) => c.openseaChain));

export function getOpenSeaChain(presetOrChain?: string | null): OpenSeaChain {
  const raw = (presetOrChain || "ETHEREUM").trim();
  if (!raw) {
    return BY_PRESET.get("ETHEREUM")!;
  }
  const upper = raw.toUpperCase().replace(/-/g, "_");
  const byPreset = BY_PRESET.get(upper);
  if (byPreset) return byPreset;

  const lower = raw.toLowerCase().replace(/-/g, "_") as OpenSeaChainId;
  if (VALID_OPENSEA.has(lower)) {
    return {
      presetKey: upper,
      label: lower,
      openseaChain: lower,
    };
  }

  return BY_PRESET.get("ETHEREUM")!;
}

export function isValidOpenSeaChain(chain: string): chain is OpenSeaChainId {
  return VALID_OPENSEA.has(chain.toLowerCase().replace(/-/g, "_") as OpenSeaChainId);
}

export function listOpenSeaChains(): OpenSeaChain[] {
  const seen = new Set<string>();
  const out: OpenSeaChain[] = [];
  for (const c of CHAINS) {
    if (seen.has(c.openseaChain)) continue;
    seen.add(c.openseaChain);
    out.push(c);
  }
  return out;
}
