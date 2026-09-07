/**
 * Adaptateur UI de `getDailyNav`.
 *
 * Hero, KPI et évolution lisent **la même** série dense : un point par jour
 * civil Paris, sans spline ni seau hebdo. Changer de période ne change que
 * la fenêtre ; cliquer Brut / Net / Financier ne change que le champ lu.
 *
 * Aucune valeur n'est calculée ici qui ne soit déjà sur le point T-05.
 */

import { sundayOfWeek } from "./historical/history-window";
import { endOfParisDay, parisDayKey } from "../dates/paris";
import {
  startOfRange,
  type EvolutionRange,
} from "./evolution-aggregate";
import { parseDayKey } from "./historical/day-key";
import type {
  DailyNavPoint,
  DailyNavScope,
} from "./historical/get-daily-nav";
import type { HistoryPoint } from "../types/ui";

/** Scopes tracés par les trois cartes Finary — ordre d'affichage. */
export const HERO_NAV_SCOPES = ["brut", "net", "financier"] as const;
export type HeroNavScope = (typeof HERO_NAV_SCOPES)[number];

export function isHeroNavScope(v: unknown): v is HeroNavScope {
  return (
    typeof v === "string" &&
    (HERO_NAV_SCOPES as readonly string[]).includes(v)
  );
}

export const HERO_NAV_SCOPE_LABEL: Record<HeroNavScope, string> = {
  financier: "Financier",
  brut: "Brut",
  net: "Net",
};

/**
 * Le titre de la carte de tête, qui doit nommer ce que le chiffre mesure.
 *
 * « Patrimoine total » surmontait indifféremment les trois cartes, y compris
 * le Financier — qui n'est pas un total mais un sous-ensemble : ni immobilier,
 * ni alternatifs. Le titre affirmait donc l'exhaustivité au-dessus d'un chiffre
 * partiel, et le camembert d'allocation, lui, répartissait bien le patrimoine
 * entier — deux périmètres sur le même écran, sans que rien ne les distingue.
 */
export const HERO_NAV_SCOPE_HEADING: Record<HeroNavScope, string> = {
  financier: "Patrimoine financier",
  brut: "Patrimoine brut",
  net: "Patrimoine net",
};

/** Phrase Financier (D3) — carte + « ? » quand cette carte est active. */
export const HERO_FINANCIER_PHRASE =
  "Titres & crypto, cash, fonds euro et ES dispo — hors immo et alternatifs.";

/**
 * Aide des trois cartes (D3). Une ligne, pas un panneau.
 * Financier = listed + cashInvest + fondsEuro + esLiquid.
 */
export const HERO_MODE_HELP =
  "Financier = titres & crypto + cash + fonds euro + ES dispo. Brut = tous les actifs. Net = brut − dettes.";

export const HERO_NAV_SCOPE_TITLE: Record<HeroNavScope, string> = {
  financier: HERO_FINANCIER_PHRASE,
  brut: "Tous les actifs",
  net: "Brut − dettes",
};

export function navOfPoint(p: DailyNavPoint, scope: HeroNavScope): number {
  switch (scope) {
    case "financier":
      return p.financier;
    case "brut":
      return p.brut;
    case "net":
      return p.net;
  }
}

/**
 * Instant de référence du fenêtrage : dernier jour de la série, pas l'horloge.
 */
export function dailyNavReferenceDay(
  points: DailyNavPoint[],
  fallback = new Date()
): string {
  const last = points[points.length - 1]?.day;
  return last ?? parisDayKey(fallback);
}

/**
 * Fenêtre dense d'une série quotidienne.
 *
 * Compare des `YYYY-MM-DD` parisiennes, jamais `Date.parse("YYYY-MM-DD")`
 * (minuit UTC, qui recule d'un jour en soirée d'été). L'ancre — dernier
 * point strictement avant la période — reste en tête pour le Δ.
 */
export function windowDailyNav<T extends { day: string }>(
  points: T[],
  range: EvolutionRange,
  referenceDay: string
): T[] {
  const from = startOfRange(range, endOfParisDay(referenceDay));
  if (!from) return points;
  const fromKey = parisDayKey(from);
  let anchorIdx = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.day < fromKey) anchorIdx = i;
  }
  const inRange = points.filter((p) => p.day >= fromKey);
  if (inRange.length === 0) return points;
  return anchorIdx >= 0 ? [points[anchorIdx]!, ...inRange] : inRange;
}

/**
 * Bornes `from`/`to` pour `GET /api/portfolio/daily-nav`.
 *
 * On demande toujours une série dense (1 pt/jour). La période n'y retire
 * aucun jour : l'écran fenêtrera ensuite. `all` part du premier jour connu
 * (historique ou première tx), pas d'un an glissant.
 */
export function dailyNavQueryWindow(
  range: EvolutionRange,
  referenceDay: string,
  earliestDay?: string | null
): { from: string; to: string } {
  const to = referenceDay;
  if (range === "all") {
    const from = earliestDay && earliestDay <= to ? earliestDay : to;
    return { from, to };
  }
  const fromDate = startOfRange(range, endOfParisDay(referenceDay));
  const from = fromDate ? parisDayKey(fromDate) : to;
  const anchor = previousDayKey(from);
  const start = anchor < from ? anchor : from;
  if (!earliestDay) return { from: start, to };
  return { from: start < earliestDay ? earliestDay : start, to };
}

function previousDayKey(day: string): string {
  const start = endOfParisDay(day).getTime() - 36 * 3600_000;
  return parisDayKey(new Date(start));
}

function firstPointDay(
  points: readonly unknown[] | undefined
): string | undefined {
  const first = points?.[0];
  if (!first || typeof first !== "object") return undefined;
  const day = "day" in first ? (first as { day?: unknown }).day : undefined;
  return typeof day === "string" ? (parseDayKey(day) ?? undefined) : undefined;
}

/**
 * Borne `from` **servie** par `GET /api/portfolio/daily-nav`.
 *
 * Uniquement `result.from` ou, à défaut, `points[0].day`. Jamais la borne
 * demandée (`dailyNavQueryWindow`) : `getDailyNav` ramène une demande trop
 * ancienne à la première observation du scope. Jamais une réponse encore
 * en vol — `keepPreviousData` d'une fenêtre 1A ferait lire « sept. 2025 »
 * pendant que « Tout » charge, puis « oct. 2022 » à l'arrivée. On n'affiche
 * la date que lorsque la réponse courante est posée, avec des points.
 */
export function servedDailyNavFrom(
  result:
    | { from?: string | null; points?: readonly unknown[] }
    | null
    | undefined,
  opts?: { isPlaceholderData?: boolean }
): string | undefined {
  if (opts?.isPlaceholderData) return undefined;
  if (!result?.points?.length) return undefined;
  return parseDayKey(result.from) ?? firstPointDay(result.points);
}

/**
 * Une ligne pour le « ? » : périmètre de la carte active + ce que la
 * courbe contient (D8). Financier porte la phrase D3, pas l'ancien
 * « titres, cash, fonds euro… ».
 */
export function heroModeHelpLine(scope: HeroNavScope): string {
  const perimeter = HERO_NAV_SCOPE_TITLE[scope];
  const base = perimeter.endsWith(".") ? perimeter : `${perimeter}.`;
  return `${base} La courbe inclut le capital investi.`;
}

/** Aide des trois cartes (tests / copie de référence). Le « ? » affiche `heroModeHelpLine`. */
export function heroModeHelpAll(): string {
  return `${HERO_MODE_HELP} La courbe inclut le capital investi.`;
}

/**
 * Flux_t du scope — même convention que `heroAttribution`.
 *
 * - **financier** : `financierFlows` (journal coté + cash). Un achat immo
 *   n'y figure pas : ΔFinancier marché reste ≈ 0, le cliff va au brut/net.
 * - **brut** : `externalFlows`.
 * - **net** : `externalFlows − Δpassifs` — un emprunt n'est pas du marché.
 *
 * L'ancre (`previous` absent) n'a pas de flux de fenêtre : 0.
 */
export function fluxOfDay(
  point: DailyNavPoint,
  previous: DailyNavPoint | undefined,
  scope: HeroNavScope
): number {
  if (!previous) return 0;
  if (scope === "financier") return point.financierFlows;
  if (scope === "brut") return point.externalFlows;
  return point.externalFlows - (point.passifs - previous.passifs);
}

/**
 * Δ marché journalier = `NAV_t − NAV_{t−1} − flux_t`.
 *
 * Ce sont les barres du graphique d'évolution : un APPORT gonfle la NAV
 * sans produire de barre verte. Le premier point (ancre) vaut 0.
 */
export function dailyNavDeltas(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      out.push(0);
      continue;
    }
    const navDelta =
      navOfPoint(points[i]!, scope) - navOfPoint(points[i - 1]!, scope);
    out.push(navDelta - fluxOfDay(points[i]!, points[i - 1], scope));
  }
  return out;
}

/**
 * Somme des Δ journaliers **hors ancre**.
 *
 * Depuis S2bis ce n'est plus `last − first` (Δ NAV) : les barres sont du
 * marché, donc `sum ≈ (last − first) − sum(flux)`.
 */
export function sumDailyDeltas(deltas: number[]): number {
  if (deltas.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < deltas.length; i++) s += deltas[i]!;
  return s;
}

export function headerDelta(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number | null {
  if (points.length < 2) return null;
  return (
    navOfPoint(points[points.length - 1]!, scope) - navOfPoint(points[0]!, scope)
  );
}

/** Σ flux_t hors ancre — le Flux d'en-tête, aligné sur `heroAttribution`. */
export function headerFlux(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number | null {
  if (points.length < 2) return null;
  let flow = 0;
  for (let i = 1; i < points.length; i++) {
    flow += fluxOfDay(points[i]!, points[i - 1], scope);
  }
  return flow;
}

/** Δ marché d'en-tête = (last − first) − Σ flux. */
export function headerMarketDelta(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number | null {
  const nav = headerDelta(points, scope);
  const flow = headerFlux(points, scope);
  if (nav == null || flow == null) return null;
  return nav - flow;
}

export type DailyNavChartPoint = {
  date: string;
  t: number;
  day: string;
  periodLabel: string;
  total: number;
  /** Δ marché du jour — hauteur de barre. 0 sur l'ancre. */
  delta: number;
  /** Flux_t du scope (financierFlows / externalFlows / net). 0 sur l'ancre. */
  flux: number;
  flows: number;
  transactionFlow: number;
  status: DailyNavPoint["status"];
  carried: boolean;
};

/**
 * Série tracée (NAV + barres Δ marché) — linéaire, aucun seau, aucun spline.
 *
 * `delta` du premier point vaut 0 : l'ancre borne la fenêtre, elle n'est
 * pas une barre de la période. Hover : Marché = `delta`, Flux = `flux`.
 */
/**
 * Ce qu'une barre désigne au survol.
 *
 * Au pas quotidien, la clé du jour suffit. Au pas hebdomadaire elle induirait
 * en erreur : la barre porte la performance et les flux de **toute** la
 * semaine, et l'annoncer par un seul jour ferait lire un mouvement de sept
 * jours comme celui d'un seul. Elle est donc nommée par la semaine qu'elle
 * couvre.
 *
 * Le point tombe presque toujours sur le dimanche qui ouvre sa semaine —
 * seule la borne qui ouvre la fenêtre (`from`) peut différer, d'où le
 * rattachement à la semaine civile plutôt qu'à la date brute du point :
 * `sundayOfWeek` retrouve le dimanche même quand le point ne tombe pas
 * dessus.
 */
export function navPointPeriodLabel(p: DailyNavPoint): string {
  return p.intervalType === "week"
    ? `semaine du dimanche ${sundayOfWeek(p.day)}`
    : p.day;
}

export function toDailyNavChartPoints(
  points: DailyNavPoint[],
  scope: HeroNavScope
): DailyNavChartPoint[] {
  const deltas = dailyNavDeltas(points, scope);
  return points.map((p, i) => {
    const at = endOfParisDay(p.day);
    const prev = i > 0 ? points[i - 1] : undefined;
    return {
      date: at.toISOString(),
      t: at.getTime(),
      day: p.day,
      periodLabel: navPointPeriodLabel(p),
      total: navOfPoint(p, scope),
      delta: deltas[i] ?? 0,
      flux: fluxOfDay(p, prev, scope),
      flows: p.externalFlows,
      transactionFlow: p.transactionFlow,
      status: p.status,
      carried:
        p.status === "ESTIMATED" ||
        p.priceOrigins.includes("MARKET_CARRIED"),
    };
  });
}

/**
 * Recompose un `HistoryPoint` par jour, pour réutiliser hero / KPI sans
 * seconde formule. La série reste dense : un point par `day`.
 */
export function dailyNavToHistoryPoints(
  points: DailyNavPoint[]
): HistoryPoint[] {
  return points.map((p) => {
    const at = endOfParisDay(p.day);
    const carried =
      p.status === "ESTIMATED" || p.priceOrigins.includes("MARKET_CARRIED");
    return {
      date: at.toISOString(),
      label: p.day,
      totalValueEur: p.brut,
      cashTotalEur: p.cash,
      totalValueBase: p.brut,
      cashTotalBase: p.cash,
      grossAssetsBase: p.brut,
      netWorthBase: p.net,
      financierBase: p.financier,
      listedBase: p.listed,
      liabilitiesBase: p.passifs,
      alternativesBase: p.alternatifs,
      employeeSavingsBase: p.employeeSavings,
      realEstateBase: p.immobilier,
      lifeInsuranceBase: p.av,
      externalFlowsBase: p.externalFlows,
      transactionFlowBase: p.transactionFlow,
      financierFlowsBase: p.financierFlows,
      byAssetClassAndEnvelopeBase: p.byAssetClassAndEnvelope,
      byAssetClassBase: p.byAssetClass,
      flowsByAssetClassBase: p.flowsByAssetClass,
      unrealizedPnlBase: p.unrealizedPnl,
      realizedPnlBase: p.realizedPnl,
      ledgerCashIncomeBase: p.ledgerCashIncome,
      status: p.status,
      estimated: carried || undefined,
    };
  });
}

export type DailyNavKpiPick =
  | "listed"
  | "cash"
  | "alternatifs"
  | "employeeSavings"
  | "passifs"
  | "unrealizedPnl"
  | "realizedPlusIncome";

export function kpiValueAt(
  p: DailyNavPoint,
  pick: DailyNavKpiPick
): number {
  switch (pick) {
    case "listed":
      return p.listed;
    case "cash":
      return p.cash;
    case "alternatifs":
      return p.alternatifs;
    case "employeeSavings":
      return p.employeeSavings;
    case "passifs":
      return p.passifs;
    case "unrealizedPnl":
      return p.unrealizedPnl;
    case "realizedPlusIncome":
      return p.realizedPnl + p.ledgerCashIncome;
  }
}

export function dailyNavKpiSeries(
  points: DailyNavPoint[],
  pick: DailyNavKpiPick
): number[] | undefined {
  if (points.length < 2) return undefined;
  return points.map((p) => kpiValueAt(p, pick));
}

/** Scope API : les trois cartes + listed pour les sparks « Titres & crypto ». */
export function dailyNavApiScope(
  scope: HeroNavScope
): Extract<DailyNavScope, HeroNavScope> {
  return scope;
}
