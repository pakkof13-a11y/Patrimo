export type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary?: string;
};

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

/** Static eco news feed (FR) — replace with a real provider later. */
const NEWS_POOL: Omit<NewsItem, "id" | "publishedAt">[] = [
  {
    title: "La BCE maintient ses taux directeurs — message prudent sur l'inflation",
    source: "Reuters",
    url: "https://www.reuters.com/",
    summary: "Le Conseil des gouverneurs laisse le statu quo monétaire.",
  },
  {
    title: "Wall Street en hausse après des chiffres d'emploi solides",
    source: "Bloomberg",
    url: "https://www.bloomberg.com/",
    summary: "Les indices US progressent sur espoirs de soft landing.",
  },
  {
    title: "Pétrole : le Brent recule sur craintes de demande chinoise",
    source: "Les Echos",
    url: "https://www.lesechos.fr/",
  },
  {
    title: "L'euro stable face au dollar avant l'indice PCE américain",
    source: "Financial Times",
    url: "https://www.ft.com/",
  },
  {
    title: "Crypto : le bitcoin consolide sous une résistance technique clé",
    source: "CoinDesk",
    url: "https://www.coindesk.com/",
  },
  {
    title: "Immobilier zone euro : les taux de crédit baissent légèrement",
    source: "Le Monde",
    url: "https://www.lemonde.fr/",
  },
  {
    title: "CAC 40 : le luxe pèse, les banques soutiennent l'indice",
    source: "Boursorama",
    url: "https://www.boursorama.com/",
  },
  {
    title: "Inflation sous-jacente : les services restent le point de vigilance",
    source: "Agence France-Presse",
    url: "https://www.afp.com/",
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
      url: "https://www.reuters.com/",
    },
    {
      title: `Analyse : momentum et valorisation de ${t} sous surveillance`,
      source: "Bloomberg",
      url: "https://www.bloomberg.com/",
    },
    {
      title: `${t} — flux institutionnels et consensus analystes`,
      source: "Financial Times",
      url: "https://www.ft.com/",
    },
    {
      title: `Marché : ${t} évolue dans un contexte sectoriel contrasté`,
      source: "Les Echos",
      url: "https://www.lesechos.fr/",
    },
    {
      title: `${t} : points clés pour le suivi de position`,
      source: "Boursorama",
      url: "https://www.boursorama.com/",
    },
    {
      title: `Veille : actualité et catalyseurs autour de ${t}`,
      source: "Zonebourse",
      url: "https://www.zonebourse.com/",
    },
  ];

  const offsets = [1, 3, 7, 14, 26, 40];
  return templates.slice(0, Math.min(limit, templates.length)).map((n, i) => ({
    id: `asset-news-${t}-${i + 1}`,
    ...n,
    publishedAt: hoursAgo(offsets[i] ?? (i + 1) * 2),
  }));
}

export function getMacroCalendarToday(): MacroEvent[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return MACRO_POOL.map((e, i) => {
    const t = new Date(y, m, d, e.hour, e.minute, 0, 0);
    // Si l’heure de publication est dépassée et qu’un consensus existe,
    // simuler un « réel » pour la bascule À venir → Publiées.
    let actual = e.actual ?? null;
    if (
      actual == null &&
      e.forecast != null &&
      t.getTime() < now.getTime() - 5 * 60 * 1000
    ) {
      actual = e.forecast;
    }
    return {
      id: `macro-${i + 1}`,
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

  // Fallback illustratif si portefeuille vide (ne marque pas inPortfolio)
  if (ordered.length === 0) {
    ordered.push(
      { ticker: "ASML.AS", name: "ASML Holding" },
      { ticker: "MC.PA", name: "LVMH" },
      { ticker: "AAPL", name: "Apple" }
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
