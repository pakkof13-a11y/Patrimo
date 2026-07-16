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

export function getMacroCalendarToday(): MacroEvent[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return MACRO_POOL.map((e, i) => {
    const t = new Date(y, m, d, e.hour, e.minute, 0, 0);
    return {
      id: `macro-${i + 1}`,
      time: t.toISOString(),
      country: e.country,
      countryCode: e.countryCode,
      title: e.title,
      impact: e.impact,
      actual: e.actual ?? null,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
    };
  });
}
