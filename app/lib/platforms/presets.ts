import { logoByDomain, logoByName, PLATFORM_DOMAINS } from "../logos/logodev";

export type PlatformPresetType =
  | "COURTIER"
  | "ASSURANCE_VIE"
  | "EXCHANGE_CRYPTO"
  | "BANQUE"
  | "BLOCKCHAIN"
  | "PORTEFEUILLE_HARDWARE"
  | "NOTAIRE_IMMOBILIER"
  | "BROKER_CFD"
  | "AUTRE";

/** Sous-catégories assurance-vie (ordre d’affichage dans le combobox) */
export const ASSURANCE_VIE_SUBTYPES = [
  "Courtiers en Ligne & Robo-Advisors",
  "Banques en Ligne",
  "Mutuelles d'Épargne",
  "Assureurs Traditionnels",
  "Banques Traditionnelles",
] as const;

export type PlatformSubtype = "Layer 1" | "Layer 2 / EVM" | string;

export type PlatformPreset = {
  key: string;
  name: string;
  type: PlatformPresetType;
  /** e.g. Layer 1 / Layer 2 / EVM for BLOCKCHAIN */
  subtype?: PlatformSubtype;
  logoUrl: string;
  domain?: string;
  needsWallet?: boolean;
  /** Short category label for combobox grouping */
  category?: string;
};

function platformLogo(name: string, domain?: string): string {
  if (domain) return logoByDomain(domain, { size: 128, format: "png", retina: true });
  const d = PLATFORM_DOMAINS[name];
  if (d) return logoByDomain(d, { size: 128, format: "png", retina: true });
  return logoByName(name, { size: 128, format: "png", retina: true });
}

function p(
  key: string,
  name: string,
  type: PlatformPresetType,
  domain: string,
  opts?: { needsWallet?: boolean; category?: string; subtype?: PlatformSubtype }
): PlatformPreset {
  return {
    key,
    name,
    type,
    domain,
    logoUrl: platformLogo(name, domain),
    needsWallet: opts?.needsWallet,
    category: opts?.category,
    subtype: opts?.subtype,
  };
}

function chain(
  key: string,
  name: string,
  domain: string,
  subtype: "Layer 1" | "Layer 2 / EVM"
): PlatformPreset {
  return p(key, name, "BLOCKCHAIN", domain, {
    needsWallet: true,
    category: "Blockchains / Wallets",
    subtype,
  });
}

/**
 * Platform presets with Logo.dev URLs (domain preferred when known).
 * Blockchains: Layer 1 vs Layer 2 / EVM via `subtype`.
 */
export const PLATFORM_PRESETS: PlatformPreset[] = [
  // ── Courtiers en bourse ───────────────────────────────────────────────────
  p("BOURSE_DIRECT", "Bourse Direct", "COURTIER", "boursedirect.fr", {
    category: "Courtiers en bourse",
  }),
  p("FORTUNEO", "Fortuneo", "COURTIER", "fortuneo.fr", {
    category: "Courtiers en bourse",
  }),
  p("BOURSOBANK", "BoursoBank (Boursorama)", "COURTIER", "boursobank.com", {
    category: "Courtiers en bourse",
  }),
  p("TRADE_REPUBLIC", "Trade Republic", "COURTIER", "traderepublic.com", {
    category: "Courtiers en bourse",
  }),
  p("DEGIRO", "DEGIRO", "COURTIER", "degiro.fr", {
    category: "Courtiers en bourse",
  }),
  p("EASYBOURSE", "EasyBourse", "COURTIER", "easybourse.com", {
    category: "Courtiers en bourse",
  }),
  p("SAXO_BANK", "Saxo Bank", "COURTIER", "home.saxo", {
    category: "Courtiers en bourse",
  }),
  p("INTERACTIVE_BROKERS", "Interactive Brokers (IBKR)", "COURTIER", "interactivebrokers.com", {
    category: "Courtiers en bourse",
  }),
  p("SCALABLE_CAPITAL", "Scalable Capital", "COURTIER", "scalable.capital", {
    category: "Courtiers en bourse",
  }),
  p("XTB", "XTB", "COURTIER", "xtb.com", {
    category: "Courtiers en bourse",
  }),
  p("TRADING_212", "Trading 212", "COURTIER", "trading212.com", {
    category: "Courtiers en bourse",
  }),
  p("REVOLUT", "Revolut", "COURTIER", "revolut.com", {
    category: "Courtiers en bourse",
  }),
  p("BITPANDA", "Bitpanda", "COURTIER", "bitpanda.com", {
    category: "Courtiers en bourse",
  }),
  p("ETORO", "eToro", "COURTIER", "etoro.com", {
    category: "Courtiers en bourse",
  }),
  p("FREEDOM24", "Freedom24", "COURTIER", "freedom24.com", {
    category: "Courtiers en bourse",
  }),
  p("IG_MARKETS", "IG", "COURTIER", "ig.com", {
    category: "Courtiers en bourse",
  }),
  p("YOMONI", "Yomoni", "COURTIER", "yomoni.fr", {
    category: "Courtiers en bourse",
  }),
  p("BFORBANK", "BforBank", "COURTIER", "bforbank.com", {
    category: "Courtiers en bourse",
  }),
  p("HELLO_BANK", "Hello bank!", "COURTIER", "hellobank.fr", {
    category: "Courtiers en bourse",
  }),
  p("CREDIT_AGRICOLE_BOURSE", "Crédit Agricole Bourse", "COURTIER", "credit-agricole.fr", {
    category: "Courtiers en bourse",
  }),
  p("BNP_PARIBAS_BOURSE", "BNP Paribas Bourse", "COURTIER", "bnpparibas.fr", {
    category: "Courtiers en bourse",
  }),

  // ── Courtiers en assurance vie (clés distinctes pour éviter les doublons COURTIER) ─
  // Courtiers en Ligne & Robo-Advisors
  p("AV_ASSURANCEVIE_COM", "Assurancevie.com", "ASSURANCE_VIE", "assurancevie.com", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_GOODVEST", "Goodvest", "ASSURANCE_VIE", "goodvest.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_LINXEA", "Linxea", "ASSURANCE_VIE", "linxea.com", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_NALO", "Nalo", "ASSURANCE_VIE", "nalo.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_PLACEMENT_DIRECT", "Placement-direct", "ASSURANCE_VIE", "placement-direct.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_RAMIFY", "Ramify", "ASSURANCE_VIE", "ramify.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  p("AV_YOMONI", "Yomoni", "ASSURANCE_VIE", "yomoni.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en Ligne & Robo-Advisors",
  }),
  // Banques en Ligne
  p("AV_BFORBANK", "BforBank", "ASSURANCE_VIE", "bforbank.com", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en Ligne",
  }),
  p("AV_BOURSOBANK", "BoursoBank", "ASSURANCE_VIE", "boursobank.com", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en Ligne",
  }),
  p("AV_FORTUNEO", "Fortuneo", "ASSURANCE_VIE", "fortuneo.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en Ligne",
  }),
  p("AV_HELLO_BANK", "Hello Bank!", "ASSURANCE_VIE", "hellobank.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en Ligne",
  }),
  p("AV_MONABANQ", "Monabanq", "ASSURANCE_VIE", "monabanq.com", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en Ligne",
  }),
  // Mutuelles d'Épargne
  p("AV_AMPLI", "AMPli Mutuelle", "ASSURANCE_VIE", "ampli-mutuelle.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  p("AV_ASAC_FAPES", "Asac-Fapes", "ASSURANCE_VIE", "asac-fapes.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  p("AV_CARAC", "Carac", "ASSURANCE_VIE", "carac.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  p("AV_GARANCE", "Garance", "ASSURANCE_VIE", "garance.com", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  p("AV_MACSF", "MACSF", "ASSURANCE_VIE", "macsf.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  p("AV_MIF", "MIF", "ASSURANCE_VIE", "mifassurances.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'Épargne",
  }),
  // Assureurs Traditionnels
  p("AV_ABEILLE", "Abeille Assurances", "ASSURANCE_VIE", "abeille-assurances.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  p("AV_ALLIANZ", "Allianz", "ASSURANCE_VIE", "allianz.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  p("AV_AXA", "AXA", "ASSURANCE_VIE", "axa.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  p("AV_GENERALI", "Generali", "ASSURANCE_VIE", "generali.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  p("AV_GROUPAMA", "Groupama", "ASSURANCE_VIE", "groupama.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  p("AV_SWISS_LIFE", "Swiss Life", "ASSURANCE_VIE", "swisslife.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs Traditionnels",
  }),
  // Banques Traditionnelles
  p("AV_BNP", "BNP Paribas", "ASSURANCE_VIE", "bnpparibas.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_CAISSE_EPARGNE", "Caisse d'Épargne", "ASSURANCE_VIE", "caisse-epargne.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_CIC", "CIC", "ASSURANCE_VIE", "cic.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_CREDIT_AGRICOLE", "Crédit Agricole", "ASSURANCE_VIE", "credit-agricole.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_CREDIT_MUTUEL", "Crédit Mutuel", "ASSURANCE_VIE", "creditmutuel.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_BANQUE_POSTALE", "La Banque Postale", "ASSURANCE_VIE", "labanquepostale.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_LCL", "LCL", "ASSURANCE_VIE", "lcl.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),
  p("AV_SOCIETE_GENERALE", "Société Générale", "ASSURANCE_VIE", "societegenerale.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques Traditionnelles",
  }),

  // ── Courtiers en CFD (clés CFD_* si homonyme courtier en bourse) ──────────
  p("CFD_ACTIVTRADES", "ActivTrades", "BROKER_CFD", "activtrades.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_ADMIRALS", "Admirals", "BROKER_CFD", "admiralmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_AVATRADE", "AvaTrade", "BROKER_CFD", "avatrade.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_CMC_MARKETS", "CMC Markets", "BROKER_CFD", "cmcmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_ETORO", "eToro", "BROKER_CFD", "etoro.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_FP_MARKETS", "FP Markets", "BROKER_CFD", "fpmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_FXCM", "FXCM", "BROKER_CFD", "fxcm.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_IG_MARKETS", "IG Markets", "BROKER_CFD", "ig.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_INTERACTIVE_BROKERS", "Interactive Brokers", "BROKER_CFD", "interactivebrokers.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_LIBERTEX", "Libertex", "BROKER_CFD", "libertex.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_PEPPERSTONE", "Pepperstone", "BROKER_CFD", "pepperstone.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_SAXO_BANQUE", "Saxo Banque", "BROKER_CFD", "home.saxo", {
    category: "Courtiers en CFD",
  }),
  p("CFD_WH_SELFINVEST", "WH SelfInvest", "BROKER_CFD", "whselfinvest.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_XTB", "XTB", "BROKER_CFD", "xtb.com", {
    category: "Courtiers en CFD",
  }),
  // Conservé (déjà présent, hors liste fournie)
  p("PLUS500", "Plus500", "BROKER_CFD", "plus500.com", {
    category: "Courtiers en CFD",
  }),

  // ── Crypto & Fintechs ─────────────────────────────────────────────────────
  p("BINANCE", "Binance", "EXCHANGE_CRYPTO", "binance.com", {
    category: "Crypto & Fintechs",
  }),
  p("COINBASE", "Coinbase", "EXCHANGE_CRYPTO", "coinbase.com", {
    category: "Crypto & Fintechs",
  }),
  p("KRAKEN", "Kraken", "EXCHANGE_CRYPTO", "kraken.com", {
    category: "Crypto & Fintechs",
  }),
  p("SWISSBORG", "Swissborg", "EXCHANGE_CRYPTO", "swissborg.com", {
    category: "Crypto & Fintechs",
  }),
  p("HYPERLIQUID", "Hyperliquid", "EXCHANGE_CRYPTO", "hyperliquid.xyz", {
    category: "Crypto & Fintechs",
  }),
  p("PARADEX", "Paradex", "EXCHANGE_CRYPTO", "paradex.trade", {
    category: "Crypto & Fintechs",
  }),
  p("N26", "N26", "BANQUE", "n26.com", { category: "Crypto & Fintechs" }),

  // ── Blockchains / Wallets — Layer 1 ───────────────────────────────────────
  chain("BITCOIN", "Bitcoin (BTC)", "bitcoin.org", "Layer 1"),
  chain("ETHEREUM", "Ethereum (ETH)", "ethereum.org", "Layer 1"),
  chain("SOLANA", "Solana (SOL)", "solana.com", "Layer 1"),
  chain("CARDANO", "Cardano (ADA)", "cardano.org", "Layer 1"),
  chain("POLKADOT", "Polkadot (DOT)", "polkadot.network", "Layer 1"),
  chain("TRON", "Tron (TRX)", "tron.network", "Layer 1"),
  chain("RIPPLE", "Ripple (XRP Ledger)", "xrpl.org", "Layer 1"),
  chain("STELLAR", "Stellar (XLM)", "stellar.org", "Layer 1"),
  chain("LITECOIN", "Litecoin (LTC)", "litecoin.org", "Layer 1"),
  chain("BITCOIN_CASH", "Bitcoin Cash (BCH)", "bitcoincash.org", "Layer 1"),
  chain("DOGECOIN", "Dogecoin (DOGE)", "dogecoin.com", "Layer 1"),
  chain("MONERO", "Monero (XMR)", "getmonero.org", "Layer 1"),
  chain("ZCASH", "Zcash (ZEC)", "z.cash", "Layer 1"),
  chain("DASH", "Dash (DASH)", "dash.org", "Layer 1"),
  chain("TEZOS", "Tezos (XTZ)", "tezos.com", "Layer 1"),
  chain("ALGORAND", "Algorand (ALGO)", "algorand.com", "Layer 1"),
  chain("NEAR", "Near (NEAR)", "near.org", "Layer 1"),
  chain("AVALANCHE", "Avalanche (AVAX)", "avax.network", "Layer 1"),
  chain("HEDERA", "Hedera (HBAR)", "hedera.com", "Layer 1"),
  chain("VECHAIN", "VeChain (VET)", "vechain.org", "Layer 1"),
  chain("FILECOIN", "Filecoin (FIL)", "filecoin.io", "Layer 1"),
  chain("INTERNET_COMPUTER", "Internet Computer (ICP)", "internetcomputer.org", "Layer 1"),
  chain("EOS", "EOS", "eosnetwork.com", "Layer 1"),
  {
    ...chain("COSMOS", "Cosmos (ATOM)", "cosmoslabs.io", "Layer 1"),
    logoUrl:
      "https://img.logo.dev/cosmoslabs.io?token=pk_KlDgf7EbR6S-rbKoHfFerA&size=128&format=png&theme=auto&fallback=monogram&retina=true",
  },
  // Kept from previous catalog (not in dense list, no deletion)
  chain("MULTIVERSX", "MultiversX", "multiversx.com", "Layer 1"),

  // ── Blockchains / Wallets — Layer 2 / EVM ─────────────────────────────────
  chain("BSC", "BNB Smart Chain (BSC)", "bnbchain.org", "Layer 2 / EVM"),
  // Historical key kept (no deletion)
  chain("BNB_CHAIN", "BNB Chain", "bnbchain.org", "Layer 2 / EVM"),
  chain("POLYGON", "Polygon", "polygon.technology", "Layer 2 / EVM"),
  chain("ARBITRUM", "Arbitrum", "arbitrum.io", "Layer 2 / EVM"),
  chain("OPTIMISM", "Optimism", "optimism.io", "Layer 2 / EVM"),
  chain("BASE", "Base", "base.org", "Layer 2 / EVM"),
  chain("ZKSYNC", "zkSync (Era)", "zksync.io", "Layer 2 / EVM"),
  chain("LINEA", "Linea", "linea.build", "Layer 2 / EVM"),
  chain("SCROLL", "Scroll", "scroll.io", "Layer 2 / EVM"),
  chain("BLAST", "Blast", "blast.io", "Layer 2 / EVM"),
  chain("MANTLE", "Mantle", "mantle.xyz", "Layer 2 / EVM"),
  chain("GNOSIS", "Gnosis Chain", "gnosis.io", "Layer 2 / EVM"),
  chain("FANTOM", "Fantom", "fantom.foundation", "Layer 2 / EVM"),
];

/** Dense blockchain catalog used by seed/migration scripts */
export const NEW_BLOCKCHAIN_PRESETS = PLATFORM_PRESETS.filter(
  (p) => p.type === "BLOCKCHAIN"
);

export function findPreset(keyOrName: string): PlatformPreset | undefined {
  const q = keyOrName.trim().toLowerCase();
  return PLATFORM_PRESETS.find(
    (p) =>
      p.key.toLowerCase() === q ||
      p.name.toLowerCase() === q ||
      p.name.toLowerCase().startsWith(q)
  );
}

export function filterPresets(query: string): PlatformPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return PLATFORM_PRESETS;
  return PLATFORM_PRESETS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.key.toLowerCase().includes(q) ||
      p.type.toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q) ||
      (p.subtype || "").toLowerCase().includes(q)
  );
}

export function resolvePlatformLogo(opts: {
  logoKey?: string | null;
  logoUrl?: string | null;
  name?: string | null;
}): string | null {
  if (opts.logoUrl?.includes("logo.dev")) return opts.logoUrl;

  if (opts.logoKey) {
    const p = findPreset(opts.logoKey);
    if (p) return p.logoUrl;
  }
  if (opts.name) {
    const p = findPreset(opts.name);
    if (p) return p.logoUrl;
    return logoByName(opts.name, { size: 128, format: "png", retina: true });
  }
  if (opts.logoUrl) return opts.logoUrl;
  return null;
}
