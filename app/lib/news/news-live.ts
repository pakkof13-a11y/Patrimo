/**
 * Actualités marché live.
 * 1) Finnhub /news (general) si clé
 * 2) Google News RSS FR (économie / bourse) — sources FR prioritaires
 * 3) Mock local
 */

import {
  newsSourceLogoUrl,
  type NewsItem,
} from "@/app/lib/news/service";
import { getEconomicNews } from "@/app/lib/news/service";

function finnhubApiKey(): string | null {
  const key = (process.env.FINNHUB_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key || key === "demo" || key === "votre-cle-finnhub") return null;
  return key;
}

type FinnhubNewsRow = {
  id?: number;
  category?: string;
  datetime?: number;
  headline?: string;
  source?: string;
  summary?: string;
  url?: string;
};

/** Sources privilégiées (FR + grands fils en français). */
const FR_SOURCE_BOOST = [
  "les echos",
  "le monde",
  "boursorama",
  "la tribune",
  "afp",
  "agence france-presse",
  "le figaro",
  "challenges",
  "latribune",
  "zonebourse",
  "investir",
  "capital",
  "bfmtv",
  "bfm business",
  "bfmbusiness",
  "boursier",
  "boursier.com",
  "france 24",
  "reuters", // souvent dispo en FR via Google News FR
];

/** Domaines économie francophones ciblés par requête RSS dédiée. */
const FR_ECONOMY_DOMAINS = [
  "bfmbusiness.com",
  "boursier.com",
  "capital.fr",
  "latribune.fr",
  "lesechos.fr",
  "challenges.fr",
];

export function isUsableArticleUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "") return false;
    if (/^\/(fr|en|us|uk|news|home)?$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

export function newsSearchFallbackUrl(title: string, source?: string): string {
  const q = [title, source].filter(Boolean).join(" ");
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function isFrSource(source: string): boolean {
  const s = source.toLowerCase();
  return FR_SOURCE_BOOST.some((f) => s.includes(f));
}

function scoreNewsItem(n: NewsItem): number {
  let s = 0;
  if (isFrSource(n.source)) s += 50;
  // Titres FR (accents / mots clés)
  if (
    /[àâäéèêëïîôùûüç]|bce|cac|euro|france|paris|bourse|inflation|pib/i.test(
      n.title
    )
  ) {
    s += 30;
  }
  if (isUsableArticleUrl(n.url)) s += 10;
  // Fraîcheur
  const ageH =
    (Date.now() - Date.parse(n.publishedAt)) / (60 * 60 * 1000);
  if (Number.isFinite(ageH) && ageH < 24) s += 20;
  else if (Number.isFinite(ageH) && ageH < 48) s += 5;
  return s;
}

export type LiveNewsResult = {
  news: NewsItem[];
  source: "finnhub" | "google-fr" | "mixed" | "mock";
};

async function fetchFinnhubGeneral(limit: number): Promise<NewsItem[]> {
  const apiKey = finnhubApiKey();
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
      }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as FinnhubNewsRow[];
    if (!Array.isArray(rows)) return [];
    const news: NewsItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const title = (row.headline || "").trim();
      if (!title || title.length < 12) continue;
      const key = title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const rawUrl = (row.url || "").trim();
      const url = isUsableArticleUrl(rawUrl)
        ? rawUrl
        : newsSearchFallbackUrl(title, row.source);
      const publishedAt =
        typeof row.datetime === "number" && row.datetime > 0
          ? new Date(row.datetime * 1000).toISOString()
          : new Date().toISOString();
      const source = (row.source || "Finnhub").trim() || "Finnhub";
      news.push({
        id: `fh-news-${row.id ?? news.length}`,
        title,
        source,
        url,
        publishedAt,
        summary: row.summary?.trim() || undefined,
        sourceLogoUrl: newsSourceLogoUrl(source, url),
      });
      if (news.length >= Math.max(limit * 3, 20)) break;
    }
    return news;
  } catch {
    return [];
  }
}

/**
 * Google News RSS FR — économie / bourse / BCE.
 * Fournit des titres en français et des liens article.
 */
async function fetchGoogleNewsFr(limit: number): Promise<NewsItem[]> {
  const siteFilter = FR_ECONOMY_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  const queries = [
    "économie OR bourse OR CAC OR BCE when:2d",
    "inflation OR taux OR marchés financiers when:2d",
    `(${siteFilter}) when:2d`,
  ];
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const url =
        "https://news.google.com/rss/search?q=" +
        encodeURIComponent(q) +
        "&hl=fr&gl=FR&ceid=FR:fr";
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "Patrimo/1.0 (portfolio news)",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      // Parse RSS items lightly
      const blocks = xml.split(/<item>/i).slice(1);
      for (const block of blocks) {
        const title = decodeXml(
          (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
            block.match(/<title>(.*?)<\/title>/i))?.[1] || ""
        ).trim();
        const link = (
          (block.match(/<link>(.*?)<\/link>/i) || [])[1] || ""
        ).trim();
        const pub = (
          (block.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1] || ""
        ).trim();
        const source = decodeXml(
          (block.match(/<source[^>]*>(.*?)<\/source>/i) || [])[1] ||
            "Google News"
        ).trim();
        if (!title || title.length < 12) continue;
        const key = title.toLowerCase().slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        let articleUrl = link;
        // Google RSS links are often redirect URLs — still usable
        if (!isUsableArticleUrl(articleUrl)) {
          articleUrl = newsSearchFallbackUrl(title, source);
        }
        const publishedAt = pub
          ? new Date(pub).toISOString()
          : new Date().toISOString();
        if (Number.isNaN(Date.parse(publishedAt))) continue;
        const src = source || "Google News FR";
        items.push({
          id: `gfr-${items.length}-${publishedAt.slice(0, 13)}`,
          title,
          source: src,
          url: articleUrl,
          publishedAt,
          sourceLogoUrl: newsSourceLogoUrl(src, articleUrl),
        });
        if (items.length >= limit * 2) break;
      }
    } catch (e) {
      console.warn(
        "[news-live] google-fr",
        e instanceof Error ? e.message : e
      );
    }
  }
  return items;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Fenêtre d'affichage : au-delà, une actualité disparaît au profit des nouvelles. */
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function isWithinDisplayWindow(n: NewsItem, now = Date.now()): boolean {
  const t = Date.parse(n.publishedAt);
  return Number.isFinite(t) && now - t <= NEWS_MAX_AGE_MS;
}

/**
 * Fusionne sources, priorise FR, garantit au moins `limit` items (min 5 côté UI).
 * Résultat trié par ordre chronologique inversé (plus récent en premier) et
 * limité aux actualités publiées dans les dernières 48h.
 */
export async function resolveEconomicNews(limit = 8): Promise<LiveNewsResult> {
  const want = Math.max(5, limit);

  const [finnhub, googleFr] = await Promise.all([
    fetchFinnhubGeneral(want),
    fetchGoogleNewsFr(want),
  ]);

  const merged: NewsItem[] = [];
  const seen = new Set<string>();
  // Google FR d’abord (préférences sources FR) pour le dédoublonnage / priorité
  for (const n of [...googleFr, ...finnhub]) {
    const key = n.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isWithinDisplayWindow(n)) continue;
    merged.push(n);
  }

  // Priorité sources FR / fraîcheur pour la sélection des candidats retenus
  merged.sort((a, b) => scoreNewsItem(b) - scoreNewsItem(a));
  let selected = merged.slice(0, Math.max(want * 2, want));

  if (selected.length < 5) {
    // Compléter avec mock (< 48h) si le live ne fournit pas assez d’actualités
    const mock = getEconomicNews(want).filter((n) => isWithinDisplayWindow(n));
    for (const n of mock) {
      const key = n.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(n);
      if (selected.length >= want) break;
    }
  }

  // Affichage : toujours par ordre chronologique inversé (plus récent en premier)
  selected = selected
    .slice()
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, want);

  const usedFr = googleFr.length > 0;
  const usedFh = finnhub.length > 0;
  const usedMock = selected.some((n) => !n.id.startsWith("gfr-") && !n.id.startsWith("fh-"));
  const source: LiveNewsResult["source"] =
    usedFr && usedFh
      ? "mixed"
      : usedFr
        ? "google-fr"
        : usedFh
          ? "finnhub"
          : usedMock
            ? "mock"
            : "mixed";

  return { news: selected, source };
}
