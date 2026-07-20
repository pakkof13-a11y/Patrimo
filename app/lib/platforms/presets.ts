/**
 * Catalogue plateformes Patrimo (`PLATFORM_PRESETS`).
 *
 * ## Classification (2026-07)
 * - Une banque / assureur remonte ici UNIQUEMENT si elle propose
 *   PEA, CTO, Crypto ou CFD (sinon → BANK_OPTIONS / prêteurs / COMMON_MANAGERS).
 * - Multi-types : `types: PlatformPresetType[]` (remplace l’ancien champ unique `type`).
 *   En base Prisma, `Platform.type` reste un string unique (type primaire = types[0]).
 * - Logos : Logo.dev via domaine (`img.logo.dev/{domain}`) ; null si domaine inconnu
 *   → fallback monogramme du combobox.
 *
 * ## Changements majeurs
 * - types multiples (Revolut, eToro, Bitpanda, banques PEA/CTO…)
 * - N26 retiré du catalogue plateformes (BANK_OPTIONS uniquement)
 * - Ajouts : Bybit, Bitget, OKX, KuCoin, Gate.io, Bitvavo, Bitfinex, Gemini,
 *   Lightyear, Swissquote, Shares, ProRealTime, Ledger/Trezor/Coldcard/Tangem,
 *   notaires, banques PEA/CTO, Sumeria, Nickel
 * - Sections triées alphabétiquement par `name`
 *
 * @see app/lib/constants.ts BANK_OPTIONS, LIABILITY_LENDERS
 * @see app/lib/employee-savings/types.ts COMMON_MANAGERS
 */

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
  /** Un ou plusieurs types métier (multi-produits). */
  types: PlatformPresetType[];
  /** e.g. Layer 1 / Layer 2 / EVM for BLOCKCHAIN */
  subtype?: PlatformSubtype;
  /** URL logo (Logo.dev) ou null → monogramme UI */
  logoUrl: string | null;
  domain?: string;
  needsWallet?: boolean;
  /** Short category label for combobox grouping */
  category?: string;
};

/** Type primaire stocké en DB / formulaires monotype. */
export function primaryType(p: PlatformPreset): PlatformPresetType {
  return p.types[0] ?? "AUTRE";
}

export function hasPlatformType(
  p: PlatformPreset,
  t: PlatformPresetType | string
): boolean {
  return p.types.includes(t as PlatformPresetType);
}

export function presetsOfType(t: PlatformPresetType | string): PlatformPreset[] {
  return PLATFORM_PRESETS.filter((p) => hasPlatformType(p, t));
}

/** Libellés types joints pour sous-titres combobox. */
export function presetTypesLabel(
  p: PlatformPreset,
  labels: Record<string, string>
): string {
  return p.types.map((t) => labels[t] || t).join(" · ");
}

function platformLogo(name: string, domain?: string | null): string | null {
  if (domain) {
    return logoByDomain(domain, { size: 128, format: "png", retina: true });
  }
  const d = PLATFORM_DOMAINS[name];
  if (d) {
    return logoByDomain(d, { size: 128, format: "png", retina: true });
  }
  if (name.trim()) {
    return logoByName(name, { size: 128, format: "png", retina: true });
  }
  return null;
}

function sortByName(a: PlatformPreset, b: PlatformPreset): number {
  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

function p(
  key: string,
  name: string,
  types: PlatformPresetType[],
  domain?: string | null,
  opts?: {
    needsWallet?: boolean;
    category?: string;
    subtype?: PlatformSubtype;
    logoUrl?: string | null;
  }
): PlatformPreset {
  const typesList =
    types.length > 0 ? types : (["AUTRE"] as PlatformPresetType[]);
  return {
    key,
    name,
    types: typesList,
    domain: domain || undefined,
    logoUrl:
      opts?.logoUrl !== undefined
        ? opts.logoUrl
        : platformLogo(name, domain),
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
  return p(key, name, ["BLOCKCHAIN"], domain, {
    needsWallet: true,
    category: "Blockchains / Wallets",
    subtype,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Sections (tri alpha appliqué à l’export final)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Une entrée canonique par marque (pas de « X Bourse » en doublon).
 * Multi-types quand la marque couvre plusieurs usages (PEA/CTO + AV + crypto…).
 */
const COURTIERS: PlatformPreset[] = [
  p(
    "BANQUE_POPULAIRE",
    "Banque Populaire",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "banquepopulaire.fr",
    { category: "Courtiers en bourse" }
  ),
  p(
    "BFORBANK",
    "BforBank",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "bforbank.com",
    { category: "Courtiers en bourse" }
  ),
  p("BITPANDA", "Bitpanda", ["COURTIER", "EXCHANGE_CRYPTO"], "bitpanda.com", {
    category: "Courtiers en bourse",
  }),
  p(
    "BNP_PARIBAS",
    "BNP Paribas",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "bnpparibas.fr",
    { category: "Courtiers en bourse" }
  ),
  p("BOURSE_DIRECT", "Bourse Direct", ["COURTIER"], "boursedirect.fr", {
    category: "Courtiers en bourse",
  }),
  p(
    "BOURSOBANK",
    "Boursorama",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "boursobank.com",
    { category: "Courtiers en bourse" }
  ),
  p(
    "CAISSE_EPARGNE",
    "Caisse d'Épargne",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "caisse-epargne.fr",
    { category: "Courtiers en bourse" }
  ),
  p("CIC", "CIC", ["COURTIER", "BANQUE", "ASSURANCE_VIE"], "cic.fr", {
    category: "Courtiers en bourse",
  }),
  p(
    "CREDIT_AGRICOLE",
    "Crédit Agricole",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "credit-agricole.fr",
    { category: "Courtiers en bourse" }
  ),
  p("DEGIRO", "DEGIRO", ["COURTIER"], "degiro.fr", {
    category: "Courtiers en bourse",
  }),
  p("EASYBOURSE", "EasyBourse", ["COURTIER"], "easybourse.com", {
    category: "Courtiers en bourse",
  }),
  p(
    "ETORO",
    "eToro",
    ["COURTIER", "BROKER_CFD", "EXCHANGE_CRYPTO"],
    "etoro.com",
    { category: "Courtiers en bourse" }
  ),
  p(
    "FORTUNEO",
    "Fortuneo",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "fortuneo.fr",
    { category: "Courtiers en bourse" }
  ),
  p("FREEDOM24", "Freedom24", ["COURTIER"], "freedom24.com", {
    category: "Courtiers en bourse",
  }),
  p(
    "HELLO_BANK",
    "Hello bank!",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "hellobank.fr",
    { category: "Courtiers en bourse" }
  ),
  p("IG_MARKETS", "IG", ["COURTIER", "BROKER_CFD"], "ig.com", {
    category: "Courtiers en bourse",
  }),
  p(
    "INTERACTIVE_BROKERS",
    "Interactive Brokers",
    ["COURTIER", "BROKER_CFD"],
    "interactivebrokers.com",
    { category: "Courtiers en bourse" }
  ),
  p(
    "BANQUE_POSTALE",
    "La Banque Postale",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "labanquepostale.fr",
    { category: "Courtiers en bourse" }
  ),
  p("LCL", "LCL", ["COURTIER", "BANQUE", "ASSURANCE_VIE"], "lcl.fr", {
    category: "Courtiers en bourse",
  }),
  p("LIGHTYEAR", "Lightyear", ["COURTIER"], "lightyear.com", {
    category: "Courtiers en bourse",
  }),
  p(
    "PROREALTIME",
    "ProRealTime",
    ["COURTIER", "BROKER_CFD"],
    "prorealtime.com",
    { category: "Courtiers en bourse" }
  ),
  p(
    "REVOLUT",
    "Revolut",
    ["COURTIER", "EXCHANGE_CRYPTO", "BANQUE", "BROKER_CFD"],
    "revolut.com",
    { category: "Courtiers en bourse" }
  ),
  p("SAXO_BANK", "Saxo Bank", ["COURTIER", "BROKER_CFD"], "home.saxo", {
    category: "Courtiers en bourse",
  }),
  p("SCALABLE_CAPITAL", "Scalable Capital", ["COURTIER"], "scalable.capital", {
    category: "Courtiers en bourse",
  }),
  p("SHARES_APP", "Shares", ["COURTIER"], "shares.io", {
    category: "Courtiers en bourse",
  }),
  p(
    "SOCIETE_GENERALE",
    "Société Générale",
    ["COURTIER", "BANQUE", "ASSURANCE_VIE"],
    "societegenerale.fr",
    { category: "Courtiers en bourse" }
  ),
  p("SWISSQUOTE", "Swissquote", ["COURTIER"], "swissquote.com", {
    category: "Courtiers en bourse",
  }),
  p("TRADE_REPUBLIC", "Trade Republic", ["COURTIER"], "traderepublic.com", {
    category: "Courtiers en bourse",
  }),
  p("TRADING_212", "Trading 212", ["COURTIER"], "trading212.com", {
    category: "Courtiers en bourse",
  }),
  p("XTB", "XTB", ["COURTIER", "BROKER_CFD"], "xtb.com", {
    category: "Courtiers en bourse",
  }),
  p("YOMONI", "Yomoni", ["COURTIER", "ASSURANCE_VIE"], "yomoni.fr", {
    category: "Courtiers en bourse",
  }),
].sort(sortByName);

/**
 * AV pure (courtiers AV / mutuelles / assureurs) — sans doublon des banques
 * déjà présentes dans COURTIERS multi-types.
 */
const ASSURANCE_VIE: PlatformPreset[] = [
  p("AV_ABEILLE", "Abeille Assurances", ["ASSURANCE_VIE"], "abeille-assurances.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
  p("AV_ALLIANZ", "Allianz", ["ASSURANCE_VIE"], "allianz.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
  p("AV_AMPLI", "AMPli Mutuelle", ["ASSURANCE_VIE"], "ampli-mutuelle.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_ASAC_FAPES", "Asac-Fapes", ["ASSURANCE_VIE"], "asac-fapes.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_ASSURANCEVIE_COM", "Assurancevie.com", ["ASSURANCE_VIE"], "assurancevie.com", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_AXA", "AXA", ["ASSURANCE_VIE"], "axa.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
  p("AV_CARAC", "Carac", ["ASSURANCE_VIE"], "carac.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_CREDIT_MUTUEL", "Crédit Mutuel", ["ASSURANCE_VIE"], "creditmutuel.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Banques traditionnelles",
  }),
  p("AV_GARANCE", "Garance", ["ASSURANCE_VIE"], "garance.com", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_GENERALI", "Generali", ["ASSURANCE_VIE"], "generali.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
  p("AV_GOODVEST", "Goodvest", ["ASSURANCE_VIE"], "goodvest.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_GROUPAMA", "Groupama", ["ASSURANCE_VIE"], "groupama.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
  p("AV_LINXEA", "Linxea", ["ASSURANCE_VIE"], "linxea.com", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_MACSF", "MACSF", ["ASSURANCE_VIE"], "macsf.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_MIF", "MIF", ["ASSURANCE_VIE"], "mifassurances.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Mutuelles d'épargne",
  }),
  p("AV_MONABANQ", "Monabanq", ["ASSURANCE_VIE"], "monabanq.com", {
    category: "Courtiers en assurance vie",
    subtype: "Banques en ligne",
  }),
  p("AV_NALO", "Nalo", ["ASSURANCE_VIE"], "nalo.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_PLACEMENT_DIRECT", "Placement-direct", ["ASSURANCE_VIE"], "placement-direct.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_RAMIFY", "Ramify", ["ASSURANCE_VIE"], "ramify.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Courtiers en ligne",
  }),
  p("AV_SWISS_LIFE", "Swiss Life", ["ASSURANCE_VIE"], "swisslife.fr", {
    category: "Courtiers en assurance vie",
    subtype: "Assureurs traditionnels",
  }),
].sort(sortByName);

/** CFD pure — marques déjà multi-types (eToro, IG, XTB…) absentes ici. */
const CFD: PlatformPreset[] = [
  p("CFD_ACTIVTRADES", "ActivTrades", ["BROKER_CFD"], "activtrades.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_ADMIRALS", "Admirals", ["BROKER_CFD"], "admiralmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_AVATRADE", "AvaTrade", ["BROKER_CFD"], "avatrade.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_CMC_MARKETS", "CMC Markets", ["BROKER_CFD"], "cmcmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_FP_MARKETS", "FP Markets", ["BROKER_CFD"], "fpmarkets.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_FXCM", "FXCM", ["BROKER_CFD"], "fxcm.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_LIBERTEX", "Libertex", ["BROKER_CFD"], "libertex.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_PEPPERSTONE", "Pepperstone", ["BROKER_CFD"], "pepperstone.com", {
    category: "Courtiers en CFD",
  }),
  p("PLUS500", "Plus500", ["BROKER_CFD"], "plus500.com", {
    category: "Courtiers en CFD",
  }),
  p("CFD_WH_SELFINVEST", "WH SelfInvest", ["BROKER_CFD"], "whselfinvest.com", {
    category: "Courtiers en CFD",
  }),
].sort(sortByName);

/**
 * Crypto — CEX / DEX perps / CeDeFi.
 * category = libellé UI principal ; subtype = nuance affichée en ligne 3.
 * type Prisma / filtre = EXCHANGE_CRYPTO pour tous.
 */
const EXCHANGES: PlatformPreset[] = [
  // ── CEX (réf. + catalogue FR déjà présents) ─────────────────────────────
  p("BINANCE", "Binance", ["EXCHANGE_CRYPTO"], "binance.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BINGX", "BingX", ["EXCHANGE_CRYPTO"], "bingx.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BITFINEX", "Bitfinex", ["EXCHANGE_CRYPTO"], "bitfinex.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BITGET", "Bitget", ["EXCHANGE_CRYPTO"], "bitget.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BITSTAMP", "Bitstamp", ["EXCHANGE_CRYPTO"], "bitstamp.net", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BITVAVO", "Bitvavo", ["EXCHANGE_CRYPTO"], "bitvavo.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("BYBIT", "Bybit", ["EXCHANGE_CRYPTO"], "bybit.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("COINBASE", "Coinbase", ["EXCHANGE_CRYPTO"], "coinbase.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("COINHOUSE", "Coinhouse", ["EXCHANGE_CRYPTO"], "coinhouse.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("CRYPTO_COM", "Crypto.com", ["EXCHANGE_CRYPTO"], "crypto.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("GATE_IO", "Gate.io", ["EXCHANGE_CRYPTO"], "gate.io", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("GEMINI", "Gemini", ["EXCHANGE_CRYPTO"], "gemini.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("KRAKEN", "Kraken", ["EXCHANGE_CRYPTO"], "kraken.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("KUCOIN", "KuCoin", ["EXCHANGE_CRYPTO"], "kucoin.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("MERIA", "Meria", ["EXCHANGE_CRYPTO"], "meria.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("MEXC", "MEXC", ["EXCHANGE_CRYPTO"], "mexc.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("OKX", "OKX", ["EXCHANGE_CRYPTO"], "okx.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),
  p("PAYMIUM", "Paymium", ["EXCHANGE_CRYPTO"], "paymium.com", {
    category: "Exchange crypto",
    subtype: "CEX",
  }),

  // ── DEX (futures / perps) ─────────────────────────────────────────────────
  p("AEVO", "Aevo", ["EXCHANGE_CRYPTO"], "aevo.xyz", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("APEX_PRO", "ApeX Pro", ["EXCHANGE_CRYPTO"], "apex.exchange", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("ASTER_DEX", "Aster DEX", ["EXCHANGE_CRYPTO"], "asterdex.com", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("AVANTIS", "Avantis", ["EXCHANGE_CRYPTO"], "avantis.finance", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("DRIFT", "Drift Protocol", ["EXCHANGE_CRYPTO"], "drift.trade", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("DYDX", "dYdX", ["EXCHANGE_CRYPTO"], "dydx.trade", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("EDGEX", "edgeX", ["EXCHANGE_CRYPTO"], "edgex.exchange", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("EVEDEX", "EVEDEX", ["EXCHANGE_CRYPTO"], "evedex.com", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("GAINS_NETWORK", "Gains Network", ["EXCHANGE_CRYPTO"], "gains.trade", {
    category: "DEX crypto",
    subtype: "Perps / futures (gTrade)",
  }),
  p("GMX", "GMX", ["EXCHANGE_CRYPTO"], "gmx.io", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("GRVT", "Grvt", ["EXCHANGE_CRYPTO"], "grvt.io", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("HYPERLIQUID", "Hyperliquid", ["EXCHANGE_CRYPTO"], "hyperliquid.xyz", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("JUPITER_PERPS", "Jupiter Perps", ["EXCHANGE_CRYPTO"], "jup.ag", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("LIGHTER", "Lighter", ["EXCHANGE_CRYPTO"], "lighter.xyz", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("MUX_PROTOCOL", "MUX Protocol", ["EXCHANGE_CRYPTO"], "mux.network", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("PARADEX", "Paradex", ["EXCHANGE_CRYPTO"], "paradex.trade", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("REYA", "Reya", ["EXCHANGE_CRYPTO"], "reya.network", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),
  p("SYNTHETIX", "Synthetix", ["EXCHANGE_CRYPTO"], "synthetix.io", {
    category: "DEX crypto",
    subtype: "Perps / futures",
  }),

  // ── CeDeFi ────────────────────────────────────────────────────────────────
  p("FINBLOX", "Finblox", ["EXCHANGE_CRYPTO"], "finblox.com", {
    category: "CeDeFi",
    subtype: "Yield / lending",
  }),
  p("NEXO", "Nexo", ["EXCHANGE_CRYPTO"], "nexo.com", {
    category: "CeDeFi",
    subtype: "Yield / lending",
  }),
  p("SWISSBORG", "Swissborg", ["EXCHANGE_CRYPTO"], "swissborg.com", {
    category: "CeDeFi",
    subtype: "Wealth app",
  }),
  p("YOUHODLER", "YouHodler", ["EXCHANGE_CRYPTO"], "youhodler.com", {
    category: "CeDeFi",
    subtype: "Yield / lending",
  }),
].sort(sortByName);

/** Fintechs cash + éventuelle crypto (pas de pure N26 ici). */
const FINTECHS: PlatformPreset[] = [
  p("NICKEL", "Nickel", ["BANQUE"], "nickel.eu", {
    category: "Fintechs",
  }),
  p("SUMERIA", "Sumeria", ["BANQUE", "EXCHANGE_CRYPTO"], "sumeria.eu", {
    category: "Fintechs",
  }),
].sort(sortByName);

const HARDWARE: PlatformPreset[] = [
  p("COLDCARD", "Coldcard", ["PORTEFEUILLE_HARDWARE"], "coldcard.com", {
    category: "Portefeuilles hardware",
    needsWallet: true,
  }),
  p("LEDGER", "Ledger", ["PORTEFEUILLE_HARDWARE"], "ledger.com", {
    category: "Portefeuilles hardware",
    needsWallet: true,
  }),
  p("TANGEM", "Tangem", ["PORTEFEUILLE_HARDWARE"], "tangem.com", {
    category: "Portefeuilles hardware",
    needsWallet: true,
  }),
  p("TREZOR", "Trezor", ["PORTEFEUILLE_HARDWARE"], "trezor.io", {
    category: "Portefeuilles hardware",
    needsWallet: true,
  }),
].sort(sortByName);

const NOTAIRES: PlatformPreset[] = [
  p(
    "NOTAIRE_GENERIQUE",
    "Notaire / Étude notariale",
    ["NOTAIRE_IMMOBILIER"],
    null,
    { category: "Notaire / Immobilier" }
  ),
  p("NOTAIRE_IMMOBILIER", "Notaire Immobilier", ["NOTAIRE_IMMOBILIER"], null, {
    category: "Notaire / Immobilier",
  }),
].sort(sortByName);

const CHAINS_L1: PlatformPreset[] = [
  chain("ALGORAND", "Algorand (ALGO)", "algorand.com", "Layer 1"),
  chain("AVALANCHE", "Avalanche (AVAX)", "avax.network", "Layer 1"),
  chain("BITCOIN", "Bitcoin (BTC)", "bitcoin.org", "Layer 1"),
  chain("BITCOIN_CASH", "Bitcoin Cash (BCH)", "bitcoincash.org", "Layer 1"),
  chain("CARDANO", "Cardano (ADA)", "cardano.org", "Layer 1"),
  {
    ...chain("COSMOS", "Cosmos (ATOM)", "cosmoslabs.io", "Layer 1"),
    logoUrl:
      "https://img.logo.dev/cosmoslabs.io?token=pk_KlDgf7EbR6S-rbKoHfFerA&size=128&format=png&theme=auto&fallback=monogram&retina=true",
  },
  chain("DASH", "Dash (DASH)", "dash.org", "Layer 1"),
  chain("DOGECOIN", "Dogecoin (DOGE)", "dogecoin.com", "Layer 1"),
  chain("EOS", "EOS", "eosnetwork.com", "Layer 1"),
  chain("ETHEREUM", "Ethereum (ETH)", "ethereum.org", "Layer 1"),
  chain("FILECOIN", "Filecoin (FIL)", "filecoin.io", "Layer 1"),
  chain("HEDERA", "Hedera (HBAR)", "hedera.com", "Layer 1"),
  chain("INTERNET_COMPUTER", "Internet Computer (ICP)", "internetcomputer.org", "Layer 1"),
  chain("LITECOIN", "Litecoin (LTC)", "litecoin.org", "Layer 1"),
  chain("MONERO", "Monero (XMR)", "getmonero.org", "Layer 1"),
  chain("MULTIVERSX", "MultiversX", "multiversx.com", "Layer 1"),
  chain("NEAR", "Near (NEAR)", "near.org", "Layer 1"),
  chain("POLKADOT", "Polkadot (DOT)", "polkadot.network", "Layer 1"),
  chain("RIPPLE", "Ripple (XRP Ledger)", "xrpl.org", "Layer 1"),
  chain("SOLANA", "Solana (SOL)", "solana.com", "Layer 1"),
  chain("STELLAR", "Stellar (XLM)", "stellar.org", "Layer 1"),
  chain("TEZOS", "Tezos (XTZ)", "tezos.com", "Layer 1"),
  chain("TRON", "Tron (TRX)", "tron.network", "Layer 1"),
  chain("VECHAIN", "VeChain (VET)", "vechain.org", "Layer 1"),
  chain("ZCASH", "Zcash (ZEC)", "z.cash", "Layer 1"),
].sort(sortByName);

const CHAINS_L2: PlatformPreset[] = [
  chain("ARBITRUM", "Arbitrum", "arbitrum.io", "Layer 2 / EVM"),
  chain("BASE", "Base", "base.org", "Layer 2 / EVM"),
  chain("BLAST", "Blast", "blast.io", "Layer 2 / EVM"),
  chain("BNB_CHAIN", "BNB Chain", "bnbchain.org", "Layer 2 / EVM"),
  chain("BSC", "BNB Smart Chain (BSC)", "bnbchain.org", "Layer 2 / EVM"),
  chain("FANTOM", "Fantom", "fantom.foundation", "Layer 2 / EVM"),
  chain("GNOSIS", "Gnosis Chain", "gnosis.io", "Layer 2 / EVM"),
  chain("LINEA", "Linea", "linea.build", "Layer 2 / EVM"),
  chain("MANTLE", "Mantle", "mantle.xyz", "Layer 2 / EVM"),
  chain("OPTIMISM", "Optimism", "optimism.io", "Layer 2 / EVM"),
  chain("POLYGON", "Polygon", "polygon.technology", "Layer 2 / EVM"),
  chain("SCROLL", "Scroll", "scroll.io", "Layer 2 / EVM"),
  chain("ZKSYNC", "zkSync (Era)", "zksync.io", "Layer 2 / EVM"),
].sort(sortByName);

/**
 * Catalogue complet — sections triées alpha en interne.
 * N26 volontairement absent (BANK_OPTIONS uniquement).
 */
export const PLATFORM_PRESETS: PlatformPreset[] = [
  ...COURTIERS,
  ...ASSURANCE_VIE,
  ...CFD,
  ...EXCHANGES,
  ...FINTECHS,
  ...HARDWARE,
  ...NOTAIRES,
  ...CHAINS_L1,
  ...CHAINS_L2,
];

/** Dense blockchain catalog used by seed/migration scripts */
export const NEW_BLOCKCHAIN_PRESETS = presetsOfType("BLOCKCHAIN");

/**
 * Alias de recherche → clé preset (saisie utilisateur → catalogue).
 */
export const PRESET_SEARCH_ALIASES: Record<string, string> = {
  boursorama: "BOURSOBANK",
  bourso: "BOURSOBANK",
  boursobank: "BOURSOBANK",
  ibkr: "INTERACTIVE_BROKERS",
  ib: "INTERACTIVE_BROKERS",
  "interactive brokers": "INTERACTIVE_BROKERS",
  tr: "TRADE_REPUBLIC",
  "trade republic": "TRADE_REPUBLIC",
  degiro: "DEGIRO",
  etoro: "ETORO",
  "e toro": "ETORO",
  saxo: "SAXO_BANK",
  "saxo bank": "SAXO_BANK",
  "saxo banque": "SAXO_BANK",
  binance: "BINANCE",
  coinbase: "COINBASE",
  kraken: "KRAKEN",
  bybit: "BYBIT",
  bitget: "BITGET",
  okx: "OKX",
  kucoin: "KUCOIN",
  "gate.io": "GATE_IO",
  gate: "GATE_IO",
  revolut: "REVOLUT",
  fortuneo: "FORTUNEO",
  "bourse direct": "BOURSE_DIRECT",
  bitpanda: "BITPANDA",
  scalable: "SCALABLE_CAPITAL",
  "trading 212": "TRADING_212",
  trading212: "TRADING_212",
  xtb: "XTB",
  freedom24: "FREEDOM24",
  lightyear: "LIGHTYEAR",
  swissquote: "SWISSQUOTE",
  ledger: "LEDGER",
  trezor: "TREZOR",
  sumeria: "SUMERIA",
  lydia: "SUMERIA",
  nickel: "NICKEL",
  meria: "MERIA",
  coinhouse: "COINHOUSE",
  nexo: "NEXO",
  "crypto.com": "CRYPTO_COM",
  crypto: "CRYPTO_COM",
  paymium: "PAYMIUM",
  bitstamp: "BITSTAMP",
  mexc: "MEXC",
  bingx: "BINGX",
  dydx: "DYDX",
  gmx: "GMX",
  hyperliquid: "HYPERLIQUID",
  youhodler: "YOUHODLER",
  finblox: "FINBLOX",
  swissborg: "SWISSBORG",
  jupiter: "JUPITER_PERPS",
  "jupiter perps": "JUPITER_PERPS",
  gtrade: "GAINS_NETWORK",
  "gains network": "GAINS_NETWORK",
  // Anciennes clés fusionnées → canonique
  bnp_paribas_bourse: "BNP_PARIBAS",
  credit_agricole_bourse: "CREDIT_AGRICOLE",
  cfd_etoro: "ETORO",
  cfd_xtb: "XTB",
  cfd_ig_markets: "IG_MARKETS",
  cfd_saxo_banque: "SAXO_BANK",
  cfd_interactive_brokers: "INTERACTIVE_BROKERS",
  av_bnp: "BNP_PARIBAS",
  av_fortuneo: "FORTUNEO",
  av_boursobank: "BOURSOBANK",
  av_yomoni: "YOMONI",
};

/** Normalise pour matching (casse, accents). */
export function normalizePlatformSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Matching strict « début de nom » (prefix) :
 * - le libellé affiché commence par la saisie, OU
 * - un mot du libellé (séparé espace / tiret / parenthèse) commence par la saisie.
 * → "volut" ne matche pas "Revolut" ; "R" matche "Revolut".
 */
export function matchesPlatformLabelPrefix(
  label: string,
  query: string
): boolean {
  const q = normalizePlatformSearch(query);
  if (!q) return true;
  const name = normalizePlatformSearch(label);
  if (name.startsWith(q)) return true;
  const tokens = name.split(/[\s/().\-–—]+/).filter(Boolean);
  return tokens.some((t) => t.startsWith(q));
}

export function findPreset(keyOrName: string): PlatformPreset | undefined {
  const raw = keyOrName.trim();
  if (!raw) return undefined;
  const q = normalizePlatformSearch(raw);

  const aliasKey = PRESET_SEARCH_ALIASES[q];
  if (aliasKey) {
    const byAlias = PLATFORM_PRESETS.find((p) => p.key === aliasKey);
    if (byAlias) return byAlias;
  }

  // Clé exacte (y compris anciennes clés canonisées)
  const byKey = PLATFORM_PRESETS.find((p) => p.key.toLowerCase() === q);
  if (byKey) return byKey;

  // Nom exact puis prefix sur libellé affiché uniquement
  return (
    PLATFORM_PRESETS.find(
      (p) => normalizePlatformSearch(p.name) === q
    ) ||
    PLATFORM_PRESETS.find((p) => matchesPlatformLabelPrefix(p.name, raw))
  );
}

export function filterPresets(query: string): PlatformPreset[] {
  const raw = query.trim();
  if (!raw) return PLATFORM_PRESETS;

  const q = normalizePlatformSearch(raw);
  const aliasKey = PRESET_SEARCH_ALIASES[q];
  const aliasHit = aliasKey
    ? PLATFORM_PRESETS.find((p) => p.key === aliasKey)
    : undefined;

  // Prefix sur nom affiché uniquement (pas type / category / key)
  const matched = PLATFORM_PRESETS.filter((p) =>
    matchesPlatformLabelPrefix(p.name, raw)
  );

  // Alias exact (ex. "ibkr") même si le nom affiché ne commence pas par ibkr
  if (aliasHit && !matched.some((p) => p.key === aliasHit.key)) {
    return [aliasHit, ...matched];
  }
  if (aliasHit) {
    return [aliasHit, ...matched.filter((p) => p.key !== aliasHit.key)];
  }
  return matched;
}

export function resolvePlatformLogo(opts: {
  logoKey?: string | null;
  logoUrl?: string | null;
  name?: string | null;
}): string | null {
  if (opts.logoUrl?.includes("logo.dev")) return opts.logoUrl;

  if (opts.logoKey) {
    const found = findPreset(opts.logoKey);
    if (found?.logoUrl) return found.logoUrl;
  }
  if (opts.name) {
    const found = findPreset(opts.name);
    if (found?.logoUrl) return found.logoUrl;
    return logoByName(opts.name, { size: 128, format: "png", retina: true });
  }
  if (opts.logoUrl) return opts.logoUrl;
  return null;
}
