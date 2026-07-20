/**
 * Capacités de synchro wallet blockchain.
 * - Solana → Helius / module solana (inchangé)
 * - EVM multi-chain → Zerion
 * - Monero → saisie locale + CoinGecko
 */

import { isSolanaAddress } from "@/app/lib/solana/address";
import {
  PLATFORM_PRESETS,
  type PlatformPreset,
} from "@/app/lib/platforms/presets";
import {
  ZERION_CHAINS,
  ZERION_HELP_MESSAGE,
  DEFAULT_ZERION_API_KEY,
  getZerionChain,
} from "@/app/lib/zerion/chains";

export type ChainSyncCapability = {
  presetKey: string;
  label: string;
  provider: "helius-solana" | "zerion" | "monero-manual";
  features: {
    portfolioSnapshot: boolean;
    ledgerTransactions: boolean;
    tokenBalances: boolean;
    nativeBalance: boolean;
    writePositions: boolean;
  };
  addressHint: string;
  validateAddress: (address: string) => boolean;
  syncPath?:
    | "/api/wallets/solana/sync"
    | "/api/wallets/zerion/sync"
    | "/api/wallets/monero/sync";
  showApiKeyField?: boolean;
  defaultApiKey?: string | null;
  helpMessage?: string | null;
  manualBalance?: boolean;
};

const SOLANA_CAP: ChainSyncCapability = {
  presetKey: "SOLANA",
  label: "Solana (SOL)",
  provider: "helius-solana",
  features: {
    portfolioSnapshot: true,
    ledgerTransactions: true,
    tokenBalances: true,
    nativeBalance: true,
    writePositions: true,
  },
  addressHint: "Adresse publique base58 (ex. 5QQu…tKnf)",
  validateAddress: isSolanaAddress,
  syncPath: "/api/wallets/solana/sync",
  showApiKeyField: false,
  helpMessage: null,
};

const MONERO_CAP: ChainSyncCapability = {
  presetKey: "MONERO",
  label: "Monero (XMR)",
  provider: "monero-manual",
  features: {
    portfolioSnapshot: true,
    ledgerTransactions: false,
    tokenBalances: false,
    nativeBalance: true,
    writePositions: true,
  },
  addressHint: "Optionnel — solde saisi localement",
  validateAddress: () => true,
  syncPath: "/api/wallets/monero/sync",
  showApiKeyField: false,
  manualBalance: true,
  helpMessage:
    "Monero n’est pas indexé par Zerion. Saisissez le solde XMR localement ; ticker, logo et cours via CoinGecko.",
};

function zerionCap(
  presetKey: string,
  label: string,
  addressHint: string,
  validateAddress: (a: string) => boolean
): ChainSyncCapability {
  return {
    presetKey,
    label,
    provider: "zerion",
    features: {
      portfolioSnapshot: true,
      ledgerTransactions: true,
      tokenBalances: true,
      nativeBalance: true,
      writePositions: true,
    },
    addressHint,
    validateAddress,
    syncPath: "/api/wallets/zerion/sync",
    showApiKeyField: true,
    defaultApiKey: DEFAULT_ZERION_API_KEY,
    helpMessage: ZERION_HELP_MESSAGE,
  };
}

const SUPPORTED: Record<string, ChainSyncCapability> = {
  SOLANA: SOLANA_CAP,
  MONERO: MONERO_CAP,
};

for (const c of ZERION_CHAINS) {
  SUPPORTED[c.presetKey] = zerionCap(
    c.presetKey,
    c.label,
    c.addressHint,
    c.validateAddress
  );
}

export function getChainSyncCapability(
  presetKey: string | null | undefined
): ChainSyncCapability | null {
  if (!presetKey) return null;
  return SUPPORTED[presetKey.toUpperCase()] ?? null;
}

export function hasChainSyncApi(presetKey: string | null | undefined): boolean {
  return getChainSyncCapability(presetKey) != null;
}

export function resolveChainSyncForPlatform(input: {
  logoKey?: string | null;
  name?: string | null;
  type?: string | null;
}): ChainSyncCapability | null {
  if (input.logoKey) {
    const byKey = getChainSyncCapability(input.logoKey);
    if (byKey) return byKey;
  }
  const name = (input.name || "").toLowerCase();
  if (name.includes("solana") || /\bsol\b/.test(name)) {
    return getChainSyncCapability("SOLANA");
  }
  if (name.includes("monero") || /\bxmr\b/.test(name)) {
    return getChainSyncCapability("MONERO");
  }
  if (name.includes("ethereum") || /\beth\b/.test(name)) {
    return getChainSyncCapability("ETHEREUM");
  }
  if (name.includes("polygon") || name.includes("matic")) {
    return getChainSyncCapability("POLYGON");
  }
  if (name.includes("arbitrum")) return getChainSyncCapability("ARBITRUM");
  if (name.includes("optimism")) return getChainSyncCapability("OPTIMISM");
  if (name.includes("base")) return getChainSyncCapability("BASE");
  if (name.includes("bsc") || name.includes("bnb")) {
    return getChainSyncCapability("BSC");
  }
  // Adresse EVM générique → Ethereum (multi-chain Zerion)
  return null;
}

export function blockchainCatalogPresets(): PlatformPreset[] {
  return PLATFORM_PRESETS.filter((p) => p.types.includes("BLOCKCHAIN"))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

export function missingApiStatusMessage(): string {
  return "API non disponible — ajout manuel des transactions uniquement";
}

export function missingApiWarning(chainLabel: string): string {
  return `${missingApiStatusMessage()} (${chainLabel}).`;
}

export function availableApiStatusMessage(): string {
  return "API existante, synchronisation disponible";
}

export function describeChainSyncFeatures(cap: ChainSyncCapability): string {
  const parts: string[] = [];
  if (cap.provider === "helius-solana") parts.push("Solana via Helius / RPC");
  else if (cap.provider === "zerion") parts.push("Zerion API (EVM multi-chain)");
  else if (cap.provider === "monero-manual") {
    parts.push("solde manuel + CoinGecko");
  }
  if (cap.features.nativeBalance) parts.push("solde natif");
  if (cap.features.tokenBalances) parts.push("tokens");
  if (cap.features.writePositions) parts.push("positions patrimoine");
  if (cap.features.ledgerTransactions) parts.push("historique on-chain");
  return parts.join(" · ");
}

export {
  ZERION_HELP_MESSAGE,
  DEFAULT_ZERION_API_KEY,
  getZerionChain,
};
