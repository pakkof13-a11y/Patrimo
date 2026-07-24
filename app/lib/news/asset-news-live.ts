/**
 * Actualités réellement liées à un actif (fiche position).
 *
 * Bug corrigé : l'ancienne implémentation (`getAssetRelatedNews`) fabriquait des
 * titres factices en injectant le ticker dans des gabarits ("USDC : les
 * investisseurs scrutent…"). Résultat : des « actualités » sans rapport, et
 * absurdes pour un stablecoin comme USDC.
 *
 * Ici on interroge Google News et on ne conserve que les articles dont le titre
 * mentionne effectivement l'actif (ticker significatif ou nom de l'émetteur).
 * Si rien de pertinent n'est trouvé → liste vide (l'UI affiche « aucune
 * actualité liée »), ce qui est le comportement correct plutôt qu'un remplissage
 * trompeur.
 */

import { type NewsItem } from "@/app/lib/news/service";
import { fetchGoogleNewsRss } from "@/app/lib/news/news-live";

/** Mots génériques ignorés dans le nom (n'apportent pas de pertinence). */
const GENERIC_NAME_WORDS = new Set([
  "the",
  "inc",
  "inc.",
  "corp",
  "corp.",
  "corporation",
  "company",
  "co",
  "co.",
  "sa",
  "s.a",
  "plc",
  "nv",
  "n.v",
  "ag",
  "spa",
  "ltd",
  "limited",
  "group",
  "groupe",
  "holding",
  "holdings",
  "class",
  "usd",
  "eur",
  "token",
  "coin",
  "protocol",
  "network",
  "finance",
  "labs",
  "dao",
  "etf",
  "fund",
  "trust",
]);

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Base d'un ticker : sans suffixe bourse (.PA) ni quote crypto (-USD). */
export function tickerBase(ticker: string | null | undefined): string {
  const t = (ticker || "").trim().toUpperCase();
  if (!t) return "";
  return t
    .replace(/\.[A-Z]{1,4}$/, "") // MC.PA → MC
    .replace(/[-/][A-Z]{3,4}$/, "") // ETH-USD → ETH
    .replace(/(.{2,})USDT?$/, "$1") // ETHUSDT/BTCUSD → ETH/BTC (garde USDT/USDC courts)
    .replace(/[^A-Z0-9]/g, "");
}

/** Tokens significatifs du nom (mots ≥ 3 lettres, hors mots génériques). */
export function nameTokens(name: string | null | undefined): string[] {
  const n = normalize(name || "");
  return n
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
}

export type AssetNewsMatcher = {
  tickerBase: string;
  fullName: string;
  tokens: string[];
};

export function buildAssetMatcher(
  ticker: string | null | undefined,
  name: string | null | undefined
): AssetNewsMatcher {
  return {
    tickerBase: tickerBase(ticker),
    fullName: normalize(name || "").trim(),
    tokens: nameTokens(name),
  };
}

/**
 * Un article est pertinent si son titre contient :
 * - le nom complet de l'actif, OU
 * - un token distinctif du nom (≥ 4 caractères, ex. « lvmh », « apple »), OU
 * - tous les tokens du nom (couvre les noms courts type « sap »), OU
 * - le ticker en tant que mot entier (ticker ≥ 3 caractères seulement — les
 *   tickers courts type « V », « MC » génèrent trop de faux positifs).
 */
export function isNewsRelevantToAsset(
  title: string,
  m: AssetNewsMatcher
): boolean {
  const t = normalize(title);
  if (!t) return false;

  if (m.fullName && m.fullName.length >= 4 && t.includes(m.fullName)) {
    return true;
  }

  if (m.tokens.length > 0) {
    const present = (tok: string) =>
      new RegExp(`\\b${escapeRe(tok)}\\b`).test(t);
    // Un token distinctif (≥4) suffit ; sinon exiger tous les tokens
    if (m.tokens.some((tok) => tok.length >= 4 && present(tok))) return true;
    if (m.tokens.every(present)) return true;
  }

  if (m.tickerBase.length >= 3) {
    const re = new RegExp(`\\b${escapeRe(m.tickerBase.toLowerCase())}\\b`);
    if (re.test(t)) return true;
  }

  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Construit la requête Google News : nom entre guillemets (signal fort) + ticker.
 * Fenêtre 14 jours pour laisser remonter des articles réellement liés.
 */
export function assetNewsQuery(
  ticker: string | null | undefined,
  name: string | null | undefined
): string {
  const parts: string[] = [];
  const n = (name || "").trim();
  const tb = tickerBase(ticker);
  if (n) parts.push(`"${n}"`);
  if (tb && tb.length >= 2 && normalize(tb) !== normalize(n)) parts.push(tb);
  const base = parts.length > 0 ? parts.join(" OR ") : tb || n;
  return `${base} when:14d`;
}

export type ResolveAssetNewsOpts = {
  ticker: string | null | undefined;
  name?: string | null;
  limit?: number;
};

/**
 * Renvoie uniquement des actualités réelles et pertinentes pour l'actif.
 * Liste vide si rien de pertinent (comportement correct, pas de remplissage).
 */
export async function resolveAssetNews(
  opts: ResolveAssetNewsOpts
): Promise<NewsItem[]> {
  const matcher = buildAssetMatcher(opts.ticker, opts.name);
  // Sans signal exploitable (ni nom, ni ticker ≥ 2) → rien à chercher
  if (!matcher.fullName && matcher.tickerBase.length < 2) return [];

  const limit = Math.min(12, Math.max(3, opts.limit ?? 6));
  const raw = await fetchGoogleNewsRss(assetNewsQuery(opts.ticker, opts.name), {
    limit,
    idPrefix: `gasset-${matcher.tickerBase || "x"}`,
  });

  const relevant = raw.filter((n) => isNewsRelevantToAsset(n.title, matcher));
  relevant.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  );
  return relevant.slice(0, limit);
}
