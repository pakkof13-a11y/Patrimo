export type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary?: string;
  /** Favicon / logo du site source (optionnel) */
  sourceLogoUrl?: string;
};

/**
 * Favicon du site source (Google s2 — robuste, pas de CORS image côté client).
 * Priorité : domaine de l’article ; fallback domaine connu par nom de source.
 */
export function newsSourceLogoUrl(
  source: string,
  articleUrl?: string | null
): string {
  const known: Record<string, string> = {
    reuters: "reuters.com",
    bloomberg: "bloomberg.com",
    "les echos": "lesechos.fr",
    "les échos": "lesechos.fr",
    "le monde": "lemonde.fr",
    "la tribune": "latribune.fr",
    bfmtv: "bfmtv.com",
    "bfm bourse": "bfmtv.com",
    cointelegraph: "cointelegraph.com",
    coindesk: "coindesk.com",
    investing: "investing.com",
    "marketwatch": "marketwatch.com",
    "financial times": "ft.com",
    "wall street journal": "wsj.com",
    "the verge": "theverge.com",
    cnbc: "cnbc.com",
    "yahoo finance": "finance.yahoo.com",
    finnhub: "finnhub.io",
  };
  let host = "";
  try {
    if (articleUrl && /^https?:\/\//i.test(articleUrl)) {
      host = new URL(articleUrl).hostname.replace(/^www\./, "");
    }
  } catch {
    host = "";
  }
  // Google News redirect → pas un vrai domaine éditeur
  if (
    !host ||
    host.includes("news.google.") ||
    host === "news.google.com"
  ) {
    const key = (source || "").trim().toLowerCase();
    host = known[key] || "";
    if (!host) {
      // heuristique : "Cointelegraph" → cointelegraph.com
      const slug = key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "");
      if (slug.length >= 3) host = `${slug}.com`;
    }
  }
  if (!host) host = "news.google.com";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export type MacroImpact = "low" | "medium" | "high";

export type MacroEvent = {
  id: string;
  time: string;
  /**
   * Short display label shown in UI (DE, EZ, UK, US…).
   * May differ from ISO when market convention uses UK / EZ.
   */
  country: string;
  /**
   * ISO-3166-1 alpha-2 (lowercase) for flag-icons / CDN SVG.
   * Examples: de, eu, gb, us. EZ → eu, UK → gb.
   */
  countryCode: string;
  title: string;
  impact: MacroImpact;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
};

/**
 * Fallback mock — liens = recherche Google News (pas de homepages vides).
 * Production : resolveEconomicNews (Finnhub) via /api/news.
 */
const NEWS_POOL: Omit<NewsItem, "id" | "publishedAt">[] = [
  {
    title: "La BCE maintient ses taux directeurs — message prudent sur l'inflation",
    source: "Reuters",
    url: "https://news.google.com/search?q=BCE+taux+directeurs&hl=fr&gl=FR&ceid=FR:fr",
    summary: "Le Conseil des gouverneurs laisse le statu quo monétaire.",
  },
  {
    title: "Wall Street en hausse après des chiffres d'emploi solides",
    source: "Bloomberg",
    url: "https://news.google.com/search?q=Wall+Street+emploi&hl=fr&gl=FR&ceid=FR:fr",
    summary: "Les indices US progressent sur espoirs de soft landing.",
  },
  {
    title: "Pétrole : le Brent recule sur craintes de demande chinoise",
    source: "Les Echos",
    url: "https://news.google.com/search?q=Brent+p%C3%A9trole+Chine&hl=fr&gl=FR&ceid=FR:fr",
  },
  {
    title: "L'euro stable face au dollar avant l'indice PCE américain",
    source: "Financial Times",
    url: "https://news.google.com/search?q=euro+dollar+PCE&hl=fr&gl=FR&ceid=FR:fr",
  },
  {
    title: "Crypto : le bitcoin consolide sous une résistance technique clé",
    source: "CoinDesk",
    url: "https://news.google.com/search?q=bitcoin+r%C3%A9sistance&hl=fr&gl=FR&ceid=FR:fr",
  },
  {
    title: "Immobilier zone euro : les taux de crédit baissent légèrement",
    source: "Le Monde",
    url: "https://news.google.com/search?q=immobilier+zone+euro+taux+cr%C3%A9dit&hl=fr&gl=FR&ceid=FR:fr",
  },
  {
    title: "CAC 40 : le luxe pèse, les banques soutiennent l'indice",
    source: "Boursorama",
    url: "https://news.google.com/search?q=CAC+40+luxe+banques&hl=fr&gl=FR&ceid=FR:fr",
  },
  {
    title: "Inflation sous-jacente : les services restent le point de vigilance",
    source: "Agence France-Presse",
    url: "https://news.google.com/search?q=inflation+sous-jacente+services+Europe&hl=fr&gl=FR&ceid=FR:fr",
  },
];

/**
 * Macro calendar seed — countryCode = ISO alpha-2 for flag-icons.
 * country = label UI (UK, EZ kept for market convention).
 */
const MACRO_POOL: Array<
  Omit<MacroEvent, "id" | "time"> & { hour: number; minute: number }
> = [
  {
    hour: 8,
    minute: 0,
    country: "DE",
    countryCode: "de",
    title: "Production industrielle (m/m)",
    impact: "medium",
    forecast: "0,2 %",
    previous: "-0,1 %",
    actual: null,
  },
  {
    hour: 9,
    minute: 0,
    country: "EZ",
    countryCode: "eu",
    title: "PIB zone euro (t/t, flash)",
    impact: "high",
    forecast: "0,3 %",
    previous: "0,2 %",
    actual: null,
  },
  {
    hour: 10,
    minute: 30,
    country: "UK",
    countryCode: "gb",
    title: "IPC Royaume-Uni (a/a)",
    impact: "high",
    forecast: "2,1 %",
    previous: "2,3 %",
    actual: null,
  },
  {
    hour: 14,
    minute: 30,
    country: "US",
    countryCode: "us",
    title: "Inscriptions chômage hebdo",
    impact: "medium",
    forecast: "215 k",
    previous: "210 k",
    actual: null,
  },
  {
    hour: 16,
    minute: 0,
    country: "US",
    countryCode: "us",
    title: "Stocks de pétrole brut (EIA)",
    impact: "low",
    forecast: "-1,2 M",
    previous: "-0,8 M",
    actual: null,
  },
  {
    hour: 20,
    minute: 0,
    country: "US",
    countryCode: "us",
    title: "Discours Fed (FOMC speakers)",
    impact: "medium",
    forecast: null,
    previous: null,
    actual: null,
  },
];

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

export function getEconomicNews(limit = 8): NewsItem[] {
  const offsets = [0.5, 1.2, 2.5, 4, 6, 9, 14, 20];
  return NEWS_POOL.slice(0, limit).map((n, i) => ({
    id: `news-${i + 1}`,
    ...n,
    publishedAt: hoursAgo(offsets[i] ?? i + 1),
  }));
}

/**
 * Actualités liées à un ticker (mock contextuel).
 * Remplacer par un fournisseur (Finnhub, Polygon, etc.) en production.
 */
export function getAssetRelatedNews(
  ticker: string | null | undefined,
  limit = 6
): NewsItem[] {
  const t = (ticker || "").trim().toUpperCase().replace(/\..*$/, "");
  if (!t || t.length < 1) return [];

  const templates: Omit<NewsItem, "id" | "publishedAt">[] = [
    {
      title: `${t} : les investisseurs scrutent les prochaines publications`,
      source: "Reuters",
      url: `https://news.google.com/search?q=${encodeURIComponent(t + " earnings")}&hl=fr&gl=FR&ceid=FR:fr`,
    },
    {
      title: `Analyse : momentum et valorisation de ${t} sous surveillance`,
      source: "Bloomberg",
      url: `https://news.google.com/search?q=${encodeURIComponent(t + " stock")}&hl=fr&gl=FR&ceid=FR:fr`,
    },
    {
      title: `${t} — flux institutionnels et consensus analystes`,
      source: "Financial Times",
      url: `https://news.google.com/search?q=${encodeURIComponent(t)}&hl=fr&gl=FR&ceid=FR:fr`,
    },
    {
      title: `Marché : ${t} évolue dans un contexte sectoriel contrasté`,
      source: "Les Echos",
      url: `https://news.google.com/search?q=${encodeURIComponent(t + " marché")}&hl=fr&gl=FR&ceid=FR:fr`,
    },
    {
      title: `${t} : points clés pour le suivi de position`,
      source: "Boursorama",
      url: `https://news.google.com/search?q=${encodeURIComponent(t + " bourse")}&hl=fr&gl=FR&ceid=FR:fr`,
    },
    {
      title: `Veille : actualité et catalyseurs autour de ${t}`,
      source: "Zonebourse",
      url: `https://news.google.com/search?q=${encodeURIComponent(t + " zonebourse")}&hl=fr&gl=FR&ceid=FR:fr`,
    },
  ];

  const offsets = [1, 3, 7, 14, 26, 40];
  return templates.slice(0, Math.min(limit, templates.length)).map((n, i) => ({
    id: `asset-news-${t}-${i + 1}`,
    ...n,
    publishedAt: hoursAgo(offsets[i] ?? (i + 1) * 2),
  }));
}

/**
 * Parse un chiffre affichable macro ("0,2 %", "215 k", "-1,2 M") → number | null.
 */
export function parseMacroNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\s/g, "").replace("%", "").replace(",", ".");
  let mult = 1;
  if (s.endsWith("k")) {
    mult = 1_000;
    s = s.slice(0, -1);
  } else if (s.endsWith("m")) {
    mult = 1_000_000;
    s = s.slice(0, -1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

/**
 * Compare résultat vs consensus pour le code couleur UI.
 * above = vert · below = rouge · equal = bleu · na = neutre
 */
export function compareActualToConsensus(
  actual: string | null | undefined,
  forecast: string | null | undefined
): "above" | "below" | "equal" | "na" {
  const a = parseMacroNumber(actual);
  const f = parseMacroNumber(forecast);
  if (a == null || f == null) return "na";
  const eps = Math.max(1e-9, Math.abs(f) * 1e-6);
  if (Math.abs(a - f) <= eps) return "equal";
  return a > f ? "above" : "below";
}

/** Simule un « réel » un peu différent du consensus (démo stable par titre). */
function simulateActualFromForecast(
  forecast: string,
  salt: string
): string {
  const n = parseMacroNumber(forecast);
  if (n == null) return forecast;
  // Hash simple du titre → écart déterministe ±
  let h = 0;
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) | 0;
  const sign = h % 2 === 0 ? 1 : -1;
  const pct = 0.02 + (Math.abs(h) % 5) * 0.01; // 2–6 %
  const bumped = n * (1 + sign * pct);
  // Reformater approximativement comme le forecast
  if (/%/.test(forecast)) {
    return `${bumped.toFixed(1).replace(".", ",")} %`;
  }
  if (/\bk\b/i.test(forecast)) {
    return `${Math.round(bumped / 1000)} k`;
  }
  if (/\bm\b/i.test(forecast)) {
    const m = bumped / 1_000_000;
    return `${m >= 0 ? "" : ""}${m.toFixed(1).replace(".", ",")} M`;
  }
  return String(Math.round(bumped * 100) / 100).replace(".", ",");
}

/**
 * Calendrier macro du **jour civil local** (Europe/Paris pour l’affichage horaire).
 * « À venir » = encore sans résultat · « Publiées » = réel renseigné.
 */
export function getMacroCalendarToday(): MacroEvent[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return MACRO_POOL.map((e, i) => {
    const t = new Date(y, m, d, e.hour, e.minute, 0, 0);
    // Si l’heure de publication est dépassée et qu’un consensus existe,
    // simuler un « réel » (≠ consensus) pour bascule À venir → Publiées + couleurs.
    let actual = e.actual ?? null;
    if (
      actual == null &&
      e.forecast != null &&
      t.getTime() < now.getTime() - 5 * 60 * 1000
    ) {
      actual = simulateActualFromForecast(e.forecast, e.title);
    }
    return {
      id: `macro-${y}${m}${d}-${i + 1}`,
      time: t.toISOString(),
      country: e.country,
      countryCode: e.countryCode,
      title: e.title,
      impact: e.impact,
      actual,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
    };
  });
}

/** Vrai si le chiffre macro est effectivement disponible (pas seulement l’heure). */
export function isMacroEventPublished(e: MacroEvent, now = new Date()): boolean {
  if (e.actual != null && String(e.actual).trim() !== "") return true;
  // Événements sans chiffre (discours) : publiés 15 min après l’heure prévue
  if (
    (e.forecast == null || String(e.forecast).trim() === "") &&
    (e.previous == null || String(e.previous).trim() === "")
  ) {
    const t = Date.parse(e.time);
    return Number.isFinite(t) && t <= now.getTime() - 15 * 60 * 1000;
  }
  return false;
}

/** Timing de publication des résultats (convention marché US/EU). */
export type EarningsTiming = "bmo" | "amc" | "during";

export type EarningsEvent = {
  id: string;
  time: string;
  companyName: string;
  ticker: string;
  timing: EarningsTiming;
  /** EPS consensus (string affichable) */
  epsEstimate: string | null;
  /** EPS publié si dispo */
  epsActual: string | null;
  /** Présent dans le portefeuille de l’utilisateur */
  inPortfolio: boolean;
  /**
   * ISO alpha-2 siège / cotation (pour drapeau) — ex. us, fr, nl, de.
   */
  countryCode?: string | null;
  /** URL logo (logo.dev ticker/name) */
  logoUrl?: string | null;
};

/** Vrai si l’EPS / résultat est réellement publié. */
export function isEarningsEventPublished(e: EarningsEvent): boolean {
  return e.epsActual != null && String(e.epsActual).trim() !== "";
}

export type PortfolioTickerRef = {
  ticker: string;
  name: string;
};

const EARNINGS_TIMING_LABEL: Record<EarningsTiming, string> = {
  bmo: "Avant ouverture",
  amc: "Après clôture",
  during: "Séance",
};

export function earningsTimingLabel(t: EarningsTiming): string {
  return EARNINGS_TIMING_LABEL[t];
}

/**
 * Calendrier résultats (mock) — priorise les tickers du portefeuille.
 * Utilisé en dernier recours si Yahoo / Finnhub indisponibles.
 * Préférer `resolveEarningsCalendar` (earnings-live) côté API.
 */
export function getEarningsCalendarMock(opts: {
  portfolio?: PortfolioTickerRef[];
  watchlist?: PortfolioTickerRef[];
  limit?: number;
}): EarningsEvent[] {
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
  const portfolio = (opts.portfolio ?? [])
    .map((p) => ({
      ticker: (p.ticker || "").trim().toUpperCase(),
      name: p.name?.trim() || p.ticker || "—",
    }))
    .filter((p) => p.ticker.length > 0);

  const watch = (opts.watchlist ?? [])
    .map((p) => ({
      ticker: (p.ticker || "").trim().toUpperCase(),
      name: p.name?.trim() || p.ticker || "—",
    }))
    .filter((p) => p.ticker.length > 0);

  const portfolioSet = new Set(
    portfolio.flatMap((p) => [
      p.ticker,
      p.ticker.replace(/\..*$/, ""),
    ])
  );
  const seen = new Set<string>();
  const ordered: PortfolioTickerRef[] = [];

  for (const p of portfolio) {
    if (seen.has(p.ticker)) continue;
    seen.add(p.ticker);
    ordered.push(p);
  }
  for (const p of watch) {
    if (seen.has(p.ticker)) continue;
    seen.add(p.ticker);
    ordered.push(p);
  }

  // Fallback illustratif actions (jamais crypto) si portefeuille equity vide
  if (ordered.length === 0) {
    ordered.push(
      { ticker: "ASML.AS", name: "ASML Holding" },
      { ticker: "MC.PA", name: "LVMH" },
      { ticker: "AAPL", name: "Apple" },
      { ticker: "MSFT", name: "Microsoft" },
      { ticker: "SAP.DE", name: "SAP" }
    );
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const timings: EarningsTiming[] = ["bmo", "amc", "during", "amc", "bmo"];
  const hours = [7, 17, 12, 18, 8, 16, 7, 17];

  return ordered.slice(0, limit).map((p, i) => {
    const timing = timings[i % timings.length]!;
    const hour = hours[i % hours.length]!;
    const t = new Date(y, m, d, hour, i % 2 === 0 ? 0 : 30, 0, 0);
    const est = (1.2 + (i % 5) * 0.35).toFixed(2).replace(".", ",");
    const hasActual = i % 3 === 0;
    const base = p.ticker.replace(/\..*$/, "");
    // country/logo enrichis côté earnings-live.enrichEarningsVisuals
    return {
      id: `earn-${p.ticker}-${i}`,
      time: t.toISOString(),
      companyName: p.name,
      ticker: p.ticker,
      timing,
      epsEstimate: est,
      epsActual: hasActual
        ? (1.15 + (i % 5) * 0.4).toFixed(2).replace(".", ",")
        : null,
      inPortfolio: portfolioSet.has(p.ticker) || portfolioSet.has(base),
    };
  });
}

/** @deprecated Utiliser getEarningsCalendarMock ou resolveEarningsCalendar */
export function getEarningsCalendar(
  opts: Parameters<typeof getEarningsCalendarMock>[0]
): EarningsEvent[] {
  return getEarningsCalendarMock(opts);
}
