/**
 * Agrégation du calendrier d’évolution patrimoniale (dashboard).
 * Règles de granularité selon la plage UI.
 */

import type { HistoryPoint } from "@/app/lib/types/ui";

export const EVOLUTION_RANGES = [
  "7d",
  "1m",
  "3m",
  "6m",
  "ytd",
  "1y",
  "5y",
  "all",
] as const;

export type EvolutionRange = (typeof EVOLUTION_RANGES)[number];

export type EvolutionInterval = "day" | "week" | "biweek" | "month";

export type EvolutionMetric = "period" | "cumul";
export type EvolutionChartStyle = "line" | "columns";
export type EvolutionViewMode = "global" | "decomposed";

export type EvolutionSeriesPoint = {
  date: string;
  /**
   * Instant de la barre, en ms. L'axe X du graphique est une échelle de
   * temps, pas une catégorie : ce champ est ce qu'elle lit.
   */
  t?: number;
  label: string;
  periodLabel: string;
  /** Valeur totale (stock) en fin de bucket */
  total: number;
  /** Capital externe entré (net) sur le bucket — jamais de la performance. */
  flows: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  /** Revenus cash cumulés (div. / coupons / loyers agrégés) */
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  /**
   * Valeur affichée principale :
   * - cumul → total
   * - period → Δ total vs bucket précédent
   */
  chartValue: number;
  /** Colonnes divergentes */
  pos: number;
  neg: number;
  /** Δ contributeurs (mode périodique décomposé) */
  dPositions: number;
  dCash: number;
  dRealized: number;
  dUnrealized: number;
  dIncome: number;
  dDividends: number;
  dCoupons: number;
  dRents: number;
  /** Série comparative rebasée (stock) */
  benchmark?: number;
  /** Δ période de la série comparative */
  benchmarkDelta?: number;
  intervalType: EvolutionInterval;
  /**
   * `ESTIMATED` dès qu'un jour du bucket repose sur une valeur reportée plutôt
   * qu'observée. L'information vient de `PortfolioValuationEngine` et n'est
   * plus perdue par l'agrégation : c'est ce qui permet à l'écran de dire d'où
   * vient un point, au lieu de tout présenter comme mesuré.
   */
  status?: "EXACT" | "ESTIMATED";
  /**
   * Le brut ventilé par classe d'actif, transporté tel quel.
   *
   * C'est un **stock**, comme `total` : la dernière observation du bucket
   * gagne, jamais une somme. Additionner les valeurs de trente jours donnerait
   * trente fois le patrimoine.
   *
   * Cette couche perdait la ventilation : le moteur la produisait, l'API la
   * publiait, et le graphique ne pouvait en tracer aucune parce qu'elle
   * s'arrêtait ici.
   */
  byAssetClass?: Record<string, number>;
  /**
   * Valeur des titres par classe puis par enveloppe fiscale.
   *
   * `null` sur `PEA` ou `CTO` veut dire absent : rien ne démontre cette
   * enveloppe à cette date. Le distinguer de zéro est tout l'objet du champ.
   */
  byAssetClassAndEnvelope?: Record<string, Record<string, number | null>>;
  /**
   * Croissance cumulée de la grandeur affichée, flux retirés, base 1 au premier
   * point de la fenêtre.
   *
   * C'est elle que l'on compare à un indice, et non la valeur : un versement
   * augmente la valeur sans qu'aucun investissement n'ait rien produit, quand
   * un indice ne reçoit jamais d'apport. Comparer les deux revenait à créditer
   * le portefeuille de ses propres dépôts.
   *
   * `undefined` quand le résultat d'investissement de la grandeur affichée
   * n'est pas connu — la comparaison est alors tue plutôt que faussée.
   */
  growth?: number;
  isLive?: boolean;
};

function parisParts(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function parisWeekdayMon0(iso: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(new Date(iso));
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[wd] ?? 0;
}

/** Début de jour civil Europe/Paris (approx. via parts locales → UTC noon-12h). */
function parisStartOfCalendarDay(now = new Date()): Date {
  const { y, m, d } = parisParts(now.toISOString());
  // Minuit Paris ≈ Date.UTC(y,m-1,d) + offset ; on utilise 00:00 UTC du jour civil
  // Paris et on élargit d’1h pour ne pas couper le jour (snapshots live du jour inclus).
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

/**
 * Début de la fenêtre affichée, ou `null` quand la plage porte tout
 * l'historique.
 *
 * Exportée pour que l'écran puisse raisonner sur la **même** fenêtre que la
 * série : l'avertissement d'historique incomplet doit couvrir exactement ce que
 * l'œil voit, et redériver ces bornes ailleurs les ferait diverger à la
 * première évolution des plages.
 */
export function startOfRange(
  range: EvolutionRange,
  now = new Date()
): Date | null {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "7d": {
      // 7 jours calendaires incluant aujourd’hui : J-6 00:00 → live
      const start = parisStartOfCalendarDay(now);
      return new Date(start.getTime() - 6 * day);
    }
    case "1m": {
      // ~4–5 semaines ISO : lundi de la semaine contenant (now - 30j)
      const approx = new Date(now.getTime() - 30 * day);
      return startOfIsoWeekMonday(approx);
    }
    case "3m": {
      const approx = new Date(now.getTime() - 93 * day);
      return startOfIsoWeekMonday(approx);
    }
    case "6m":
      return new Date(now.getTime() - 183 * day);
    case "ytd": {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
      }).formatToParts(now);
      const y = Number(
        parts.find((p) => p.type === "year")?.value ?? now.getFullYear()
      );
      return new Date(Date.UTC(y, 0, 1, 0, 0, 0));
    }
    case "1y":
      return new Date(now.getTime() - 365 * day);
    case "5y":
      return new Date(now.getTime() - 5 * 365 * day);
    case "all":
      return null;
  }
}

/**
 * Points de l'historique compris dans une période.
 *
 * **Une seule** implémentation de « ce que couvre la période », partagée par la
 * courbe d'évolution et par le bandeau d'indicateurs qui l'accompagne. Les deux
 * blocs décrivent le même écran : deux filtrages écrits séparément auraient
 * fini par diverger d'un jour, et l'écart aurait été invisible.
 *
 * Le point qui précède immédiatement la fenêtre est conservé **en tête** quand
 * il existe : c'est la valeur de départ de la période, sans laquelle la
 * première variation n'aurait rien à quoi se comparer. Il borne la fenêtre, il
 * n'en fait pas partie.
 *
 * Historique plus court que la période demandée : tout est rendu plutôt que
 * rien. Une fenêtre plus courte qu'annoncée reste lisible ; un écran vide, non.
 */
export function windowForRange<T extends { date: string }>(
  points: T[],
  range: EvolutionRange,
  now = new Date()
): T[] {
  const valid = points.filter((p) => Number.isFinite(Date.parse(p.date)));
  const from = startOfRange(range, now);
  if (!from) return valid;

  const fromT = from.getTime();
  let anchorIdx = -1;
  for (let i = 0; i < valid.length; i++) {
    if (Date.parse(valid[i]!.date) < fromT) anchorIdx = i;
  }
  const inRange = valid.filter((p) => Date.parse(p.date) >= fromT);
  if (inRange.length === 0) return valid;
  return anchorIdx >= 0 ? [valid[anchorIdx]!, ...inRange] : inRange;
}

/** Lundi 00:00 (civil Paris) de la semaine ISO contenant `date`. */
export function startOfIsoWeekMonday(date: Date): Date {
  const iso = date.toISOString();
  const { y, m, d } = parisParts(iso);
  const mon0 = parisWeekdayMon0(iso);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const mondayNoon = new Date(utcNoon - mon0 * 24 * 60 * 60 * 1000);
  const { y: my, m: mm, d: md } = {
    y: mondayNoon.getUTCFullYear(),
    m: mondayNoon.getUTCMonth() + 1,
    d: mondayNoon.getUTCDate(),
  };
  return new Date(Date.UTC(my, mm - 1, md, 0, 0, 0));
}

/**
 * Granularité selon la plage (spec produit).
 * - 7J → journalier (7 jours calendaires, jour courant inclus / live)
 * - 1M / 3M → hebdomadaire ISO (lundi 00:00 → dimanche 23:59)
 * - 6M / YTD → hebdomadaire
 * - 1A → bi-hebdo si dense, sinon mensuel
 * - 5A / Tout → mensuel
 */
export function resolveEvolutionInterval(
  range: EvolutionRange,
  pointCountInRange: number
): EvolutionInterval {
  if (range === "7d") return "day";
  if (range === "1m" || range === "3m") return "week";
  if (range === "6m" || range === "ytd") return "week";
  if (range === "1y") {
    return pointCountInRange >= 40 ? "biweek" : "month";
  }
  return "month";
}

/** Libellé court pour sous-titre (résolution d’affichage). */
export function evolutionIntervalLabel(iv: EvolutionInterval): string {
  switch (iv) {
    case "day":
      return "journalière";
    case "week":
      return "hebdomadaire";
    case "biweek":
      return "bihebdomadaire";
    case "month":
      return "mensuelle";
  }
}

/** Libellé long pour tooltips / accessibilité. */
export function evolutionIntervalHint(iv: EvolutionInterval): string {
  switch (iv) {
    case "day":
      return "un point par jour";
    case "week":
      return "un point par semaine";
    case "biweek":
      return "un point toutes les deux semaines";
    case "month":
      return "un point par mois";
  }
}

/**
 * Clé de bucket stable.
 * Semaine = semaine calendaire ISO Europe/Paris (lundi → dimanche).
 */
export function bucketKey(iso: string, interval: EvolutionInterval): string {
  const { y, m, d } = parisParts(iso);
  if (interval === "day") {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (interval === "month") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  // week / biweek — lundi de la semaine ISO (Paris)
  const monday = startOfIsoWeekMonday(new Date(iso));
  const my = monday.getUTCFullYear();
  const mm = monday.getUTCMonth() + 1;
  const md = monday.getUTCDate();
  const weekKey = `W${my}-${String(mm).padStart(2, "0")}-${String(md).padStart(2, "0")}`;
  if (interval === "week") return weekKey;
  const start = new Date(Date.UTC(my, 0, 1));
  const weekNum = Math.floor(
    (monday.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  return `BW${my}-${String(Math.floor(weekNum / 2)).padStart(2, "0")}`;
}

function formatDayMonthShort(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
  }).format(d);
}

/**
 * Libellé axe / tooltip semaine ISO :
 * « S. 13 juil. - 19 juil. » (lundi → dimanche)
 */
export function formatWeekRangeLabel(iso: string): string {
  const mon = startOfIsoWeekMonday(new Date(iso));
  const sun = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  return `S. ${formatDayMonthShort(mon)} - ${formatDayMonthShort(sun)}`;
}

function formatAxisLabel(iso: string, interval: EvolutionInterval): string {
  const d = new Date(iso);
  if (interval === "month") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      month: "short",
      year: "2-digit",
    }).format(d);
  }
  if (interval === "week" || interval === "biweek") {
    return formatWeekRangeLabel(iso);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function formatPeriodLabel(iso: string, interval: EvolutionInterval): string {
  const d = new Date(iso);
  if (interval === "month") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      month: "long",
      year: "numeric",
    }).format(d);
  }
  if (interval === "week" || interval === "biweek") {
    return formatWeekRangeLabel(iso);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
  }).format(d);
}

type StockAcc = {
  date: string;
  total: number;
  /**
   * Capital externe entré (net) sur le bucket.
   *
   * Contrairement aux autres champs, qui sont des **stocks** relevés en fin de
   * bucket, celui-ci est un **flux** : il s'additionne. Prendre la dernière
   * valeur du bucket perdrait tous les versements du mois sauf le dernier, et
   * le rendement pondéré par le temps les recompterait en performance.
   */
  flows: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  /**
   * Statut de valorisation du bucket, agrégé au plus faible.
   *
   * `PortfolioValuationEngine` marque chaque jour `EXACT` ou `ESTIMATED` ;
   * cette couche laissait tomber l'information, si bien que la courbe
   * quotidienne ne pouvait pas dire ce que le moteur savait. Un bucket qui
   * contient un seul jour estimé est estimé : c'est le seul agrégat honnête,
   * puisque le total du bucket repose alors sur une valeur non observée.
   */
  status?: "EXACT" | "ESTIMATED";
  /**
   * Valeur de chaque classe d'actif à ce point, en devise de base.
   *
   * `sum(byAssetClass) === total` quand `total` est la valeur brute — c'est la
   * même partition que celle vérifiée dans le moteur, transportée sans
   * recalcul. Absent quand la source ne l'a pas fourni : un graphique ne doit
   * pas pouvoir confondre « classe à zéro » et « ventilation inconnue ».
   */
  byAssetClass?: Record<string, number>;
  /**
   * Valeur des titres par classe puis par enveloppe fiscale.
   *
   * `null` sur `PEA` ou `CTO` veut dire absent : rien ne démontre cette
   * enveloppe à cette date. Le distinguer de zéro est tout l'objet du champ.
   */
  byAssetClassAndEnvelope?: Record<string, Record<string, number | null>>;
  /**
   * Résultat d'investissement de la période, en devise : ce que le moteur
   * calcule comme `valeur(D) − valeur(D−1) − flux(D)`, transporté tel quel.
   *
   * `undefined` quand la grandeur affichée n'en a pas.
   */
  perf?: number;
  /**
   * Croissance cumulée de la grandeur affichée, flux retirés, base 1 au premier
   * point de la fenêtre.
   *
   * C'est elle que l'on compare à un indice, et non la valeur : un versement
   * augmente la valeur sans qu'aucun investissement n'ait rien produit, quand
   * un indice ne reçoit jamais d'apport. Comparer les deux revenait à créditer
   * le portefeuille de ses propres dépôts.
   *
   * `undefined` quand le résultat d'investissement de la grandeur affichée
   * n'est pas connu — la comparaison est alors tue plutôt que faussée.
   */
  growth?: number;
  isLive?: boolean;
};

/**
 * Densifie la série journalière 7J : un point par jour civil de la fenêtre
 * (J-6 … aujourd’hui). Jours sans snapshot = report de la dernière valeur connue
 * (après le premier point réel).
 */
function densifyDailyCalendar(
  stock: StockAcc[],
  from: Date,
  now: Date
): StockAcc[] {
  if (stock.length === 0) return stock;

  const dayMs = 24 * 60 * 60 * 1000;
  const byDay = new Map<string, StockAcc>();
  for (const s of stock) {
    byDay.set(bucketKey(s.date, "day"), s);
  }

  const start = parisStartOfCalendarDay(from);
  const end = parisStartOfCalendarDay(now);
  const out: StockAcc[] = [];
  let carry: StockAcc | null = null;

  // Valeur d’amorçage : dernier point strictement avant la fenêtre
  for (const s of stock) {
    if (Date.parse(s.date) < start.getTime()) {
      carry = { ...s, isLive: false };
    }
  }

  for (
    let t = start.getTime();
    t <= end.getTime() + dayMs / 2;
    t += dayMs
  ) {
    const dayDate = new Date(t);
    const key = bucketKey(dayDate.toISOString(), "day");
    const hit = byDay.get(key);
    if (hit) {
      carry = { ...hit };
      out.push(hit);
    } else if (carry) {
      // Report : même valorisation, horodatage = milieu de journée civil
      const { y, m, d } = parisParts(dayDate.toISOString());
      out.push({
        ...carry,
        date: new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString(),
        // Le report reconduit un **stock**, jamais un flux : sans cette remise
        // à zéro, le versement du dernier jour connu serait recompté à chaque
        // journée sans observation.
        flows: 0,
        // Une valeur reconduite depuis un jour antérieur n'a pas été observée
        // ce jour-là : c'est la définition même d'`ESTIMATED`.
        status: "ESTIMATED",
        isLive: false,
      });
    }
    // avant le premier snapshot : pas de point inventé
  }

  return out.length > 0 ? out : stock;
}

function normalizePoint(p: HistoryPoint): {
  date: string;
  total: number;
  flows: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  status?: "EXACT" | "ESTIMATED";
  byAssetClass?: Record<string, number>;
  byAssetClassAndEnvelope?: Record<string, Record<string, number | null>>;
  /**
   * Résultat d'investissement de la période, en devise : ce que le moteur
   * calcule comme `valeur(D) − valeur(D−1) − flux(D)`, transporté tel quel.
   *
   * `undefined` quand la grandeur affichée n'en a pas.
   */
  perf?: number;
  /** Croissance cumulée, posée après coup par le chaînage du rendement. */
  growth?: number;
  isLive?: boolean;
} {
  const total = Number(p.totalValueBase) || 0;
  const cash = Number(p.cashTotalBase) || 0;
  const positions =
    p.positionsBase != null ? Number(p.positionsBase) : total - cash;
  const dividends = Number(p.dividendsBase) || 0;
  const coupons = Number(p.couponsBase) || 0;
  const rents = Number(p.rentsBase) || 0;
  const income =
    Number(p.cashIncomeBase) || dividends + coupons + rents || 0;
  const perfRaw = p.investmentPerformanceBase;
  return {
    date: p.date,
    total,
    flows: Number(p.externalFlowsBase) || 0,
    perf:
      perfRaw == null || !Number.isFinite(Number(perfRaw))
        ? undefined
        : Number(perfRaw),
    cash,
    positions,
    realized: Number(p.realizedPnlBase) || 0,
    unrealized: Number(p.unrealizedPnlBase) || 0,
    income,
    dividends,
    coupons,
    rents,
    /*
      Tout ce qui n'est pas `EXACT` est traité comme non observé.

      Le moteur connaît un troisième état, `MISSING`. Le réduire à `ESTIMATED`
      ici est délibéré : cette couche n'a que deux façons de présenter un point,
      et ranger un jour sans donnée du côté du « mesuré » serait la seule
      erreur vraiment coûteuse. Un statut absent — un appelant qui ne le fournit
      pas — reste `undefined`, et n'affirme donc rien.
    */
    status:
      p.status == null ? undefined : p.status === "EXACT" ? "EXACT" : "ESTIMATED",
    byAssetClass: p.byAssetClassBase,
    byAssetClassAndEnvelope: p.byAssetClassAndEnvelopeBase,
    isLive: p.isLive,
  };
}

/**
 * Filtre + agrège + applique le mode périodique / cumulé.
 */
export function buildEvolutionSeries(
  raw: HistoryPoint[],
  range: EvolutionRange,
  metric: EvolutionMetric,
  now = new Date()
): { points: EvolutionSeriesPoint[]; interval: EvolutionInterval } {
  if (raw.length === 0) {
    return { points: [], interval: "day" };
  }

  /*
    Le fenêtrage n'est plus écrit ici : il est partagé avec le bandeau
    d'indicateurs (`windowForRange`). Même code, donc même période — c'était la
    seule façon de garantir que les tuiles et la courbe parlent de la même
    tranche de temps. Le comportement est inchangé : dates invalides écartées,
    point d'ancrage conservé en tête pour le Δ, historique trop court rendu en
    entier.
  */
  const filtered = windowForRange(raw.map(normalizePoint), range, now);

  /*
    La borne elle-même sert encore deux fois plus bas — densification du 7J,
    retrait de l'ancre en mode cumul. Même appel, même `now` que dans
    `windowForRange` : les deux ne peuvent pas désigner deux instants
    différents.
  */
  const from = startOfRange(range, now);

  /*
    Rendement chaîné, jour par jour, sur la fenêtre affichée.

    C'est la seule grandeur du portefeuille comparable à un indice. La variation
    de valeur ne l'est pas : elle contient les apports et les retraits, quand un
    indice n'en reçoit jamais. Sur le compte de démonstration, l'écart entre les
    deux atteint près de sept points.

    On chaîne plutôt qu'on ne divise la somme des résultats par la valeur
    initiale, parce qu'un versement déplace la base en cours de route : les
    journées qui le suivent produisent leur résultat sur un capital plus grand,
    et le rapporter à la mise de départ le surévaluerait. Chaîner
    `1 + résultat(D) / valeur(D−1)` neutralise exactement cela — c'est ce que
    fait un indice, et c'est ce qui rend les deux comparables.

    Le numérateur est le résultat d'investissement du moteur, transporté sans
    recalcul : `valeur(D) − valeur(D−1) − flux(D)`. La convention de performance
    du produit est donc la même ici que partout ailleurs.

    Une journée dont la base est nulle ou négative ne produit pas de rendement
    définissable : la croissance est reportée telle quelle plutôt que d'inventer
    un pourcentage. Et si le résultat d'investissement manque, la croissance
    reste absente — la comparaison sera tue, pas approximée.
  */
  {
    let facteur: number | undefined = 1;
    for (let i = 0; i < filtered.length; i++) {
      const pt = filtered[i]!;
      if (i === 0) {
        pt.growth = facteur;
        continue;
      }
      const base = filtered[i - 1]!.total;
      const perf = pt.perf;
      if (facteur == null || perf == null) {
        facteur = undefined;
      } else if (base > 0) {
        facteur = facteur * (1 + perf / base);
      }
      pt.growth = facteur;
    }
  }

  /*
    Un point par jour de la fenêtre, déjà échantillonné en amont par
    `downsampleSeries`. Les seaux hebdo / mensuels + un axe catégoriel
    produisaient des marches : deux semaines voisines prenaient la même
    largeur qu'un jour, et un saut de valorisation se lisait comme un
    escalier. L'axe du graphique est désormais une échelle de temps ; la
    granularité affichée reste le jour, et `interval` ne sert plus qu'à
    formater les ticks.
  */
  const interval: EvolutionInterval = "day";

  let stock: StockAcc[] = filtered;

  // 7J : densifier tous les jours calendaires (report des valeurs manquantes)
  if (range === "7d" && interval === "day" && from) {
    stock = densifyDailyCalendar(stock, from, now);
  }

  // Si ancre hors plage : on l’utilise pour le premier Δ puis on peut la retirer
  // en mode cumul si from est défini
  const fromT = from?.getTime() ?? null;

  const points: EvolutionSeriesPoint[] = stock.map((s, i) => {
    const prev = i > 0 ? stock[i - 1]! : null;
    const dTotal = prev ? s.total - prev.total : 0;
    const chartValue = metric === "cumul" ? s.total : dTotal;
    return {
      date: s.date,
      t: Date.parse(s.date),
      label: formatAxisLabel(s.date, interval),
      periodLabel: formatPeriodLabel(s.date, interval),
      total: s.total,
      flows: s.flows,
      cash: s.cash,
      positions: s.positions,
      realized: s.realized,
      unrealized: s.unrealized,
      income: s.income,
      dividends: s.dividends,
      coupons: s.coupons,
      rents: s.rents,
      chartValue,
      pos: chartValue >= 0 ? chartValue : 0,
      neg: chartValue < 0 ? chartValue : 0,
      dPositions: prev ? s.positions - prev.positions : 0,
      dCash: prev ? s.cash - prev.cash : 0,
      dRealized: prev ? s.realized - prev.realized : 0,
      dUnrealized: prev ? s.unrealized - prev.unrealized : 0,
      dIncome: prev ? s.income - prev.income : 0,
      dDividends: prev ? s.dividends - prev.dividends : 0,
      dCoupons: prev ? s.coupons - prev.coupons : 0,
      dRents: prev ? s.rents - prev.rents : 0,
      // Stock, comme `total` : la croissance de fin de bucket fait foi.
      growth: s.growth,
      intervalType: interval,
      status: s.status,
      byAssetClass: s.byAssetClass,
      byAssetClassAndEnvelope: s.byAssetClassAndEnvelope,
      isLive: s.isLive,
    };
  });

  // Retirer l’ancre pure (avant from) de l’affichage
  let display = points;
  if (fromT != null && display.length > 1) {
    const firstIn = display.findIndex((p) => Date.parse(p.date) >= fromT);
    if (firstIn > 0) {
      display = display.slice(firstIn);
    }
  }

  // En périodique, le 1er point sans précédent utile → 0 (déjà le cas si ancre absente)
  return { points: display, interval };
}

/**
 * Variation de la période, et **rendement** de la période.
 *
 * Les deux chiffres ne mesurent pas la même chose et le libellé doit les
 * distinguer : `delta` est la variation du patrimoine, versements compris ;
 * `pct` est le rendement pondéré par le temps, versements neutralisés.
 *
 * Le calcul naïf `(fin − début) / début` affichait « +382 430 % » sur la plage
 * complète du jeu de démonstration — non parce que le portefeuille avait été
 * multiplié par quatre mille, mais parce qu'il avait commencé à 240 € et reçu
 * des apports pendant vingt-huit ans. Un versement n'est pas une performance.
 */
export function evolutionDeltaSummary(points: EvolutionSeriesPoint[]): {
  first: number;
  last: number;
  delta: number;
  pct: number;
  /** Capital externe net apporté sur la période, hors valeur de départ. */
  flows: number;
} | null {
  if (points.length < 1) return null;
  const first = points[0]!.total;
  const last = points[points.length - 1]!.total;
  const delta = last - first;

  let flows = 0;
  let factor = 1;
  let measured = false;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.total;
    const curr = points[i]!.total;
    const flow = points[i]!.flows;
    flows += flow;
    // Le capital exposé sur le sous-période inclut le flux : sans lui, un
    // versement compterait comme un gain sur la base de la veille.
    const base = prev + flow;
    if (base <= 0) continue;
    factor *= curr / base;
    measured = true;
  }

  const pct = measured ? (factor - 1) * 100 : first > 0 ? (delta / first) * 100 : 0;
  return { first, last, delta, pct, flows };
}

/** Périodes activables selon profondeur d’historique disponible. */
export function isEvolutionRangeEnabled(
  range: EvolutionRange,
  firstDateIso: string | null,
  now = new Date()
): boolean {
  if (range === "7d" || range === "all") return true;
  if (!firstDateIso) return false;
  const ageDays =
    (now.getTime() - Date.parse(firstDateIso)) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(ageDays)) return false;
  switch (range) {
    case "1m":
      return ageDays >= 14;
    case "3m":
      return ageDays >= 45;
    case "6m":
      return ageDays >= 90;
    case "ytd": {
      const yStart = startOfRange("ytd", now);
      return yStart != null && Date.parse(firstDateIso) < yStart.getTime();
    }
    case "1y":
      return ageDays >= 180;
    case "5y":
      return ageDays >= 365;
    default:
      return true;
  }
}


export type EvolutionBenchmarkMode = "none" | "index";

/** Clôture d'indice brute (rebasée ensuite sur le premier total du portefeuille). */
export type IndexClosePoint = { date: string; close: number };

/** Sélectionne la dernière clôture d'indice ≤ date de barre (tolérance 36 h). */
function makeIndexPicker(indexCloses: IndexClosePoint[]) {
  const sorted = [...indexCloses]
    .filter((c) => Number.isFinite(Date.parse(c.date)) && c.close > 0)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return (barDate: string): number | null => {
    const t = Date.parse(barDate);
    if (!Number.isFinite(t)) return null;
    let best: number | null = null;
    for (const c of sorted) {
      if (Date.parse(c.date) <= t + 36e5) best = c.close;
      else break;
    }
    return best;
  };
}

export type BenchmarkOptions = {
  /** Clôtures d'indice, brutes — rebasées sur `baseTotal`. */
  indexCloses?: IndexClosePoint[];
};

/**
 * Attache une série comparative **rebasée** sur le premier total du portefeuille.
 * Alignement temporel : même dates que la série principale.
 *
 * Une seule comparaison possible : la performance réelle de l'indice choisi
 * (clôtures Yahoo), rebasée sur le premier total du portefeuille → directement
 * comparable en €.
 *
 * En mode périodique, `benchmark` reste le stock rebasé ; le graphe dérive le Δ
 * via le point précédent.
 */
export function withBenchmarkSeries(
  points: EvolutionSeriesPoint[],
  mode: EvolutionBenchmarkMode,
  opts: BenchmarkOptions = {}
): EvolutionSeriesPoint[] {
  if (mode === "none" || points.length === 0) {
    return points.map((p) => ({ ...p, benchmark: undefined }));
  }

  const baseTotal = points[0]!.total;
  if (!Number.isFinite(baseTotal) || baseTotal <= 0) {
    return points.map((p) => ({ ...p, benchmark: undefined }));
  }

  // index : rebasage des clôtures réelles sur baseTotal
  let levelAt: (iso: string) => number;
  {
    const closes = opts.indexCloses ?? [];
    const pick = makeIndexPicker(closes);
    const baseClose = pick(points[0]!.date);
    if (baseClose == null || baseClose <= 0) {
      // Pas de données indice → pas de courbe (évite une ligne plate trompeuse)
      return points.map((p) => ({ ...p, benchmark: undefined }));
    }
    levelAt = (iso) => {
      const c = pick(iso) ?? baseClose;
      return baseTotal * (c / baseClose);
    };
  }

  return points.map((p, i) => {
    const benchmark = levelAt(p.date);
    const prevBm = i > 0 ? levelAt(points[i - 1]!.date) : benchmark;
    return {
      ...p,
      benchmark,
      benchmarkDelta: i === 0 ? 0 : benchmark - prevBm,
    };
  });
}

export type EvolutionPercentPoint = {
  date: string;
  t?: number;
  label: string;
  periodLabel: string;
  /** Performance du portefeuille depuis le premier point affiché, en %. */
  portfolioPct: number;
  /** Performance du benchmark sur la même fenêtre, rebasée à 0 % au même point. */
  benchmarkPct?: number;
};

/**
 * Reprojette une série déjà rebasée par `withBenchmarkSeries` en performance
 * relative : les deux courbes partent à 0 % au premier point affiché. C'est
 * la seule transformation qui rend portefeuille et benchmark comparables sans
 * mélanger unité monétaire et pourcentage sur le même axe — l'un des deux
 * axes doit céder, jamais un affichage mixte.
 */
export function toPercentSeries(
  points: EvolutionSeriesPoint[]
): EvolutionPercentPoint[] {
  if (points.length === 0) return [];
  const base = points[0]!.total;
  const safeBase = base > 0 ? base : null;
  /*
    Base de croissance : celle du premier point **affiché**.

    La fenêtre peut commencer bien après le début de la série, et la croissance
    est cumulée depuis ce début. La ramener ici fait partir la courbe à 0 %,
    comme celle de l'indice.
  */
  const g0 = points[0]!.growth;
  const growthBase = g0 != null && g0 > 0 ? g0 : null;
  return points.map((p) => ({
    date: p.date,
    t: p.t ?? Date.parse(p.date),
    label: p.label,
    periodLabel: p.periodLabel,
    /*
      Le portefeuille est rendu par son rendement chaîné, jamais par sa
      variation de valeur : celle-ci contient les apports, que l'indice ne
      connaît pas. `growthBase` ramène la croissance au premier point affiché,
      la fenêtre pouvant commencer bien après le début de la série.
    */
    portfolioPct:
      growthBase != null && p.growth != null
        ? (p.growth / growthBase - 1) * 100
        : 0,
    benchmarkPct:
      safeBase && p.benchmark != null
        ? ((p.benchmark - safeBase) / safeBase) * 100
        : undefined,
  }));
}

export function benchmarkLabel(mode: EvolutionBenchmarkMode): string {
  switch (mode) {
    case "none":
      return "Aucun";
    case "index":
      return "Indice";
  }
}

/**
 * Écart de performance (points de %) entre le portefeuille et le benchmark sur
 * la période affichée : perf portefeuille − perf benchmark.
 * `null` si non calculable (pas de benchmark ou base nulle).
 */
export function benchmarkGapPct(
  points: EvolutionSeriesPoint[]
): { portfolioPct: number; benchmarkPct: number; gapPct: number } | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (!(first.total > 0)) return null;
  /*
    Même grandeur des deux côtés.

    `portfolioPct` valait la variation de valeur entre les bornes, apports
    compris. Sur la fenêtre par défaut du compte de démonstration, cela donnait
    +8,71 % là où les investissements avaient produit +1,96 % : les 61 325 € de
    versements de la période étaient comptés comme de la performance, et
    l'écart annoncé avec l'indice s'en trouvait faux de près de sept points.
  */
  if (first.growth == null || last.growth == null || !(first.growth > 0)) {
    return null;
  }
  const portfolioPct = (last.growth / first.growth - 1) * 100;
  const b0 = first.benchmark;
  const b1 = last.benchmark;
  if (b0 == null || b1 == null || !(b0 > 0)) return null;
  const benchmarkPct = ((b1 - b0) / b0) * 100;
  return {
    portfolioPct,
    benchmarkPct,
    gapPct: portfolioPct - benchmarkPct,
  };
}
