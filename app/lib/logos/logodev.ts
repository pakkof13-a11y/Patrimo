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
 * URLs héritées de fournisseurs abandonnés. Elles restent stockées en base sur
 * d'anciennes lignes et répondent encore 200 pour certaines, mais mélanger deux
 * sources donne des logos de tailles et de fonds différents sur la même ligne :
 * on les ignore au profit de logo.dev.
 */
const LEGACY_HOSTS = [
  "clearbit.com",
  "simpleicons.org",
  "jsdelivr.net",
  "cryptologos.cc",
];

function isUsableStoredUrl(url?: string | null): url is string {
  if (!url) return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) return false;
  return !LEGACY_HOSTS.some((host) => u.includes(host));
}

/**
 * Les identifiants de logo.dev ne se valident pas côté client : un ticker
 * inconnu et un ticker valide renvoient tous deux une image. On ne peut donc
 * pas « choisir » la bonne source à l'avance — on ordonne les tentatives de la
 * plus spécifique à la plus générale et on laisse le rendu descendre la liste
 * sur erreur. Seul le dernier maillon a un fallback monogramme : sinon logo.dev
 * répondrait 200 avec une initiale dès la première tentative et masquerait les
 * suivantes.
 */
function chain(
  builders: Array<(o: LogoDevOptions) => string>,
  size: number,
  theme: "auto" | "light" | "dark"
): string[] {
  return builders.map((build, i) =>
    build({
      size: Math.max(size * 2, 64),
      format: "png",
      theme,
      retina: true,
      fallback: i === builders.length - 1 ? "monogram" : "404",
    })
  );
}

const CRYPTO_QUOTE_SUFFIX = /(USDT|USDC|USD|EUR)$/i;

/**
 * Tickers crypto usuels : la classe d'actif suffit dans la plupart des cas,
 * mais une ligne mal classée ne doit pas partir chercher une action « BTC ».
 */
const KNOWN_CRYPTO_TICKERS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK",
  "MATIC", "ATOM", "EGLD", "ARB", "OP", "USDT", "USDC", "DAI", "LTC", "TRX",
]);

function isCryptoAsset(assetClass: string, ticker: string): boolean {
  const cls = assetClass.toUpperCase();
  if (cls === "CRYPTO" || cls === "STABLECOIN" || cls === "NFT") return true;
  return KNOWN_CRYPTO_TICKERS.has(ticker.toUpperCase().replace(CRYPTO_QUOTE_SUFFIX, ""));
}

/**
 * Sources candidates pour un actif, de la plus fiable à la plus approximative.
 * Crypto → symbole ; titre coté → ticker puis ISIN ; à défaut, le nom.
 */
export function assetLogoSources(opts: {
  logoUrl?: string | null;
  ticker?: string | null;
  isin?: string | null;
  name?: string | null;
  assetClass?: string | null;
  size?: number;
  theme?: "auto" | "light" | "dark";
}): string[] {
  const ticker = (opts.ticker || "").trim();
  const isin = (opts.isin || "").trim();
  const name = (opts.name || "").trim();
  const size = opts.size ?? 64;
  const theme = opts.theme ?? "auto";

  const builders: Array<(o: LogoDevOptions) => string> = [];
  if (ticker && isCryptoAsset(opts.assetClass || "", ticker)) {
    builders.push((o) => logoByCrypto(ticker, o));
  } else {
    // Euronext & co. arrivent déjà sous la forme MC.PA — laissée telle quelle.
    if (ticker) builders.push((o) => logoByTicker(ticker, o));
    if (isin) builders.push((o) => logoByIsin(isin, o));
  }
  if (name) builders.push((o) => logoByName(name, o));

  const sources = chain(builders, size, theme);
  // Une URL déjà stockée passe devant : c'est un choix explicite de l'utilisateur
  // ou le résultat d'un import, pas une déduction.
  return isUsableStoredUrl(opts.logoUrl) ? [opts.logoUrl, ...sources] : sources;
}

/** Domaine connu d'une plateforme, insensible à la casse et aux espaces. */
export function platformDomain(name?: string | null): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  for (const [label, domain] of Object.entries(PLATFORM_DOMAINS)) {
    if (label.toLowerCase() === key) return domain;
  }
  return null;
}

/**
 * Sources candidates pour une plateforme (courtier, banque, exchange, chaîne).
 * Le domaine est de loin le plus fiable chez logo.dev ; la recherche par nom
 * ne sert que pour les établissements absents de la table.
 */
export function platformLogoSources(opts: {
  logoUrl?: string | null;
  name?: string | null;
  domain?: string | null;
  size?: number;
  theme?: "auto" | "light" | "dark";
}): string[] {
  const name = (opts.name || "").trim();
  const domain = opts.domain?.trim() || platformDomain(name);
  const size = opts.size ?? 64;
  const theme = opts.theme ?? "auto";

  const builders: Array<(o: LogoDevOptions) => string> = [];
  if (domain) builders.push((o) => logoByDomain(domain, o));
  if (name) builders.push((o) => logoByName(name, o));

  const sources = chain(builders, size, theme);
  return isUsableStoredUrl(opts.logoUrl) ? [opts.logoUrl, ...sources] : sources;
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
