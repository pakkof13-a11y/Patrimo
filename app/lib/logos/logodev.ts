/**
 * Logo.dev image CDN — https://www.logo.dev/docs/logo-images/introduction
 *
 * Publishable key is safe to use in <img> src (client-side).
 * Prefer NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY in .env.
 */

const BASE = "https://img.logo.dev";

export type LogoDevOptions = {
  size?: number;
  format?: "jpg" | "png" | "webp";
  theme?: "auto" | "light" | "dark";
  retina?: boolean;
  fallback?: "monogram" | "404";
};

function getToken(): string {
  return (
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ||
    process.env.LOGO_DEV_PUBLISHABLE_KEY ||
    // Publishable key provided for this project (safe client-side)
    "pk_KlDgf7EbR6S-rbKoHfFerA"
  );
}

function withParams(path: string, opts: LogoDevOptions = {}): string {
  const params = new URLSearchParams();
  params.set("token", getToken());
  params.set("size", String(opts.size ?? 128));
  params.set("format", opts.format ?? "png");
  params.set("theme", opts.theme ?? "auto");
  params.set("fallback", opts.fallback ?? "monogram");
  if (opts.retina) params.set("retina", "true");
  // path may already include leading slash segment
  return `${BASE}/${path}?${params.toString()}`;
}

/** Domain lookup — most reliable when known (e.g. lvmh.com) */
export function logoByDomain(domain: string, opts?: LogoDevOptions): string {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return withParams(encodeURIComponent(clean), opts);
}

/** Company name — `name/Stripe` */
export function logoByName(name: string, opts?: LogoDevOptions): string {
  return withParams(`name/${encodeURIComponent(name.trim())}`, opts);
}

/**
 * Stock ticker — US: AAPL · non-US: AAPL.L, MC.PA, AIR.PA
 * Logo.dev expects ticker/AAPL or ticker/MC.PA style identifiers.
 */
export function logoByTicker(ticker: string, opts?: LogoDevOptions): string {
  const t = ticker.trim().toUpperCase();
  return withParams(`ticker/${encodeURIComponent(t)}`, opts);
}

/** Crypto symbol — crypto/BTC */
export function logoByCrypto(symbol: string, opts?: LogoDevOptions): string {
  const s = symbol.trim().toUpperCase().replace(/USDT$|USD$|EUR$/, "");
  return withParams(`crypto/${encodeURIComponent(s)}`, opts);
}

/** ISIN — isin/US0378331005 */
export function logoByIsin(isin: string, opts?: LogoDevOptions): string {
  return withParams(`isin/${encodeURIComponent(isin.trim().toUpperCase())}`, opts);
}

/**
 * Best-effort logo for a portfolio asset.
 * Priority: explicit URL → crypto → ticker → company name.
 */
export function logoForAsset(opts: {
  logoUrl?: string | null;
  ticker?: string | null;
  name?: string | null;
  assetClass?: string | null;
  size?: number;
  theme?: "auto" | "light" | "dark";
}): string | null {
  if (opts.logoUrl && !opts.logoUrl.includes("clearbit.com") && !opts.logoUrl.includes("simpleicons.org")) {
    // Keep custom / already-resolved non-legacy URLs
    if (opts.logoUrl.includes("logo.dev") || opts.logoUrl.startsWith("http")) {
      // Re-use explicit stored logo.dev or other URLs
      if (!opts.logoUrl.includes("clearbit.com") && !opts.logoUrl.includes("jsdelivr.net")) {
        return opts.logoUrl;
      }
    }
  }
  if (opts.logoUrl?.includes("logo.dev")) return opts.logoUrl;

  const ticker = (opts.ticker || "").trim();
  const name = (opts.name || "").trim();
  const cls = (opts.assetClass || "").toUpperCase();
  const common: LogoDevOptions = {
    size: opts.size ?? 128,
    format: "png",
    theme: opts.theme ?? "auto",
    retina: true,
    fallback: "monogram",
  };

  if (cls === "CRYPTO" || isLikelyCryptoTicker(ticker)) {
    const sym = ticker.replace(/USDT$|USD$|EUR$/i, "") || name;
    if (sym) return logoByCrypto(sym, common);
  }

  if (ticker) {
    // Euronext etc. already use MC.PA form — pass through
    return logoByTicker(ticker, common);
  }

  if (name) {
    return logoByName(name, common);
  }

  return null;
}

/**
 * Best-effort logo for a platform (broker, bank, exchange).
 */
export function logoForPlatform(opts: {
  logoUrl?: string | null;
  name?: string | null;
  domain?: string | null;
  size?: number;
  theme?: "auto" | "light" | "dark";
}): string | null {
  if (opts.logoUrl?.includes("logo.dev")) return opts.logoUrl;

  const common: LogoDevOptions = {
    size: opts.size ?? 128,
    format: "png",
    theme: opts.theme ?? "auto",
    retina: true,
    fallback: "monogram",
  };

  if (opts.domain) return logoByDomain(opts.domain, common);
  if (opts.name) return logoByName(opts.name, common);
  return opts.logoUrl || null;
}

function isLikelyCryptoTicker(ticker: string): boolean {
  const t = ticker.toUpperCase();
  return ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "USDT", "USDC"].includes(
    t
  );
}

/** Known platform website domains for more reliable lookups */
export const PLATFORM_DOMAINS: Record<string, string> = {
  BoursoBank: "boursobank.com",
  Boursorama: "boursorama.com",
  Fortuneo: "fortuneo.fr",
  "Bourse Direct": "boursedirect.fr",
  "Trade Republic": "traderepublic.com",
  "Interactive Brokers": "interactivebrokers.com",
  Degiro: "degiro.fr",
  "Saxo Bank": "home.saxo",
  eToro: "etoro.com",
  Plus500: "plus500.com",
  XTB: "xtb.com",
  "IG Markets": "ig.com",
  "FXCM EU": "fxcm.com",
  Binance: "binance.com",
  Coinbase: "coinbase.com",
  Kraken: "kraken.com",
  Swissborg: "swissborg.com",
  Hyperliquid: "hyperliquid.xyz",
  Paradex: "paradex.trade",
  Revolut: "revolut.com",
  "Hello Bank": "hellobank.fr",
  N26: "n26.com",
  Ethereum: "ethereum.org",
  Solana: "solana.com",
  MultiversX: "multiversx.com",
  "Cosmos Chain": "cosmos.network",
  Bitcoin: "bitcoin.org",
  "BNB Chain": "bnbchain.org",
  Avalanche: "avax.network",
  Arbitrum: "arbitrum.io",
  Optimism: "optimism.io",
  Polygon: "polygon.technology",
};
