/**
 * Presets catalogue supportés par Zerion (EVM multi-chain).
 * Solana = Helius (module dédié, non géré ici).
 * Monero = saisie locale + CoinGecko.
 *
 * Note : Zerion ne couvre pas BTC / DOGE / Cosmos / MultiversX en adresses natives.
 */

export type ZerionChainDef = {
  presetKey: string;
  label: string;
  /** filter[chain_ids] Zerion (ex. ethereum, polygon) */
  zerionChainId: string | null;
  addressHint: string;
  validateAddress: (address: string) => boolean;
};

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
function evm(a: string) {
  return EVM_RE.test(a.trim());
}

export const ZERION_CHAINS: ZerionChainDef[] = [
  {
    presetKey: "ETHEREUM",
    label: "Ethereum (ETH)",
    zerionChainId: "ethereum",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "POLYGON",
    label: "Polygon",
    zerionChainId: "polygon",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "ARBITRUM",
    label: "Arbitrum",
    zerionChainId: "arbitrum",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "OPTIMISM",
    label: "Optimism",
    zerionChainId: "optimism",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "BASE",
    label: "Base",
    zerionChainId: "base",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "BSC",
    label: "BNB Smart Chain (BSC)",
    zerionChainId: "binance-smart-chain",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "BNB_CHAIN",
    label: "BNB Chain",
    zerionChainId: "binance-smart-chain",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "AVALANCHE",
    label: "Avalanche (AVAX)",
    zerionChainId: "avalanche",
    addressHint: "Adresse EVM 0x… (C-Chain)",
    validateAddress: evm,
  },
  {
    presetKey: "FANTOM",
    label: "Fantom",
    zerionChainId: "fantom",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "GNOSIS",
    label: "Gnosis Chain",
    zerionChainId: "xdai",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "LINEA",
    label: "Linea",
    zerionChainId: "linea",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "SCROLL",
    label: "Scroll",
    zerionChainId: "scroll",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "ZKSYNC",
    label: "zkSync (Era)",
    zerionChainId: "zksync-era",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "BLAST",
    label: "Blast",
    zerionChainId: "blast",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
  {
    presetKey: "MANTLE",
    label: "Mantle",
    zerionChainId: "mantle",
    addressHint: "Adresse EVM 0x…",
    validateAddress: evm,
  },
];

const BY_PRESET = new Map(
  ZERION_CHAINS.map((c) => [c.presetKey.toUpperCase(), c])
);

export function getZerionChain(
  presetKey: string | null | undefined
): ZerionChainDef | null {
  if (!presetKey) return null;
  return BY_PRESET.get(presetKey.toUpperCase()) ?? null;
}

export function isZerionPreset(presetKey: string | null | undefined): boolean {
  return getZerionChain(presetKey) != null;
}

/**
 * Placeholder UI uniquement — **jamais** de clé réelle dans le bundle client.
 * La clé effective est résolue server-side via `ZERION_API_KEY` (env Vercel/local).
 */
export const DEFAULT_ZERION_API_KEY = "";

export const ZERION_HELP_MESSAGE =
  "Pour récupérer les soldes et l’historique des wallets multi-chaînes (EVM : Ethereum, Polygon, Arbitrum, Base, BSC…), nous utilisons l’API Zerion. La clé serveur (ZERION_API_KEY) est utilisée par défaut ; vous pouvez en fournir une depuis https://dashboard.zerion.io/ (plan gratuit : 1 req/s, 300 req/jour). Solana → RPC (SOLANA_RPC_URL recommandé). Monero = saisie locale + CoinGecko.";
