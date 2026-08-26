/**
 * Inflation française — cumul de l'IPC sur une fenêtre.
 *
 * ## Ce que ce module remplace
 *
 * La comparaison « Portefeuille / Inflation » reposait sur une constante :
 * `FRENCH_ANNUAL_CPI_RATE = 0.02`, appliquée en continu au prorata du temps
 * écoulé. Elle produisait une exponentielle lisse, jamais un IPC : ni la
 * saisonnalité, ni les mois de baisse, ni les publications réelles n'y
 * apparaissaient. Un utilisateur voyait « l'inflation » alors qu'il regardait
 * une hypothèse de 2 % par an.
 *
 * Ici, rien n'est supposé. L'inflation cumulée se calcule à partir
 * d'observations mensuelles réelles, et **n'existe pas** quand elles manquent.
 *
 * ## Composition, jamais addition
 *
 * Six mois à +0,2 / +0,4 / −0,1 / +0,2 / +0,1 / −0,1 % ne font pas +0,7 %.
 * Ils font :
 *
 * ```
 * (1,002 × 1,004 × 0,999 × 1,002 × 1,001 × 0,999) − 1 = +0,7009…%
 * ```
 *
 * L'écart est minime sur six mois et devient sensible sur cinq ans : additionner
 * cinq années à 4 % donnerait 20 %, alors que la composition donne 21,67 %.
 * C'est la différence entre une somme de pourcentages et un pouvoir d'achat.
 *
 * ## Date économique, pas date de publication
 *
 * Une observation porte le **mois qu'elle décrit** (`period`), pas le jour où
 * l'INSEE l'a publiée ni celui où Patrimo l'a lue. L'IPC de janvier reste
 * l'IPC de janvier, qu'il ait été publié en février ou révisé en mars.
 */

/** Mois économique au format `YYYY-MM` — tri lexicographique = chronologique. */
export type CpiPeriod = string;

/**
 * Observation mensuelle de l'IPC.
 *
 * `monthlyRate` est la variation **mensuelle** en fraction (0,002 = +0,2 %),
 * telle que la source la publie. On ne la reconstruit pas depuis un indice si
 * la source donne déjà le taux, et inversement : deux chemins de calcul pour la
 * même grandeur finissent par diverger.
 */
export type CpiObservation = {
  period: CpiPeriod;
  monthlyRate: number;
};

/** Variation annuelle publiée, pour les fenêtres longues. */
export type CpiYearlyObservation = {
  /** Année civile décrite, ou le mois de référence du glissement. */
  period: string;
  yearlyRate: number;
};

/**
 * Compose des variations relatives.
 *
 * `[0.002, 0.004]` → `1,002 × 1,004 − 1`. Générique en nombre de termes, et
 * c'est le seul endroit du module où l'arithmétique du cumul est écrite.
 */
export function compose(rates: readonly number[]): number {
  let factor = 1;
  for (const r of rates) {
    if (!Number.isFinite(r)) continue;
    factor *= 1 + r;
  }
  return factor - 1;
}

/** Observations d'une fenêtre `[from, to]`, bornes comprises, triées. */
export function observationsInWindow(
  observations: readonly CpiObservation[],
  from: CpiPeriod,
  to: CpiPeriod
): CpiObservation[] {
  return observations
    .filter((o) => o.period >= from && o.period <= to)
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** `YYYY-MM` d'une date, en temps universel — un mois n'a pas de fuseau. */
export function periodOf(date: Date): CpiPeriod {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Le mois précédent, sans dépendance à une bibliothèque de dates. */
export function previousPeriod(period: CpiPeriod): CpiPeriod {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Les `count` mois consécutifs se terminant à `end`, du plus ancien au plus récent. */
export function periodsEndingAt(end: CpiPeriod, count: number): CpiPeriod[] {
  const out: CpiPeriod[] = [];
  let p = end;
  for (let i = 0; i < count; i++) {
    out.unshift(p);
    p = previousPeriod(p);
  }
  return out;
}

/**
 * Un point de la courbe d'inflation : cumul depuis le début de la fenêtre.
 *
 * `cumulative` vaut 0 au premier point — c'est la référence commune avec la
 * variation du portefeuille, et ce qui rend les deux séries comparables sur un
 * axe unique en pourcentage.
 */
export type CpiCumulativePoint = {
  period: CpiPeriod;
  /** Cumul depuis le début de la fenêtre, en fraction (0,021 = +2,1 %). */
  cumulative: number;
  /** Variation du mois lui-même, telle que publiée. */
  monthlyRate: number;
};

/**
 * Série cumulée mensuelle sur une fenêtre.
 *
 * Le premier point est la **référence** : il vaut 0 et ne consomme pas la
 * variation de son propre mois — sans quoi la courbe démarrerait déjà décalée,
 * et l'inflation du mois de départ serait comptée avant que la fenêtre ne
 * commence.
 *
 * Rend `null` dès qu'un mois manque à l'appel : une composition amputée d'un
 * mois n'est pas une inflation « approximative », c'est une autre grandeur.
 */
export function cumulativeSeries(
  observations: readonly CpiObservation[],
  periods: readonly CpiPeriod[]
): CpiCumulativePoint[] | null {
  if (periods.length === 0) return null;

  const byPeriod = new Map(observations.map((o) => [o.period, o]));
  const out: CpiCumulativePoint[] = [];
  const rates: number[] = [];

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const obs = byPeriod.get(period);
    if (!obs) return null;

    if (i === 0) {
      // Le point de départ pose la référence : cumul nul, quoi qu'ait fait ce
      // mois-là avant l'ouverture de la fenêtre.
      out.push({ period, cumulative: 0, monthlyRate: obs.monthlyRate });
      continue;
    }
    rates.push(obs.monthlyRate);
    out.push({
      period,
      cumulative: compose(rates),
      monthlyRate: obs.monthlyRate,
    });
  }

  return out;
}

/**
 * Cumul sur les `months` derniers mois disponibles.
 *
 * `null` si la profondeur manque. Rendre un cumul plus court en le présentant
 * comme « six mois » serait faux, et le compléter par des zéros le serait plus
 * encore.
 */
export function cumulativeOverMonths(
  observations: readonly CpiObservation[],
  months: number
): number | null {
  if (months <= 0) return null;
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  if (!last) return null;

  const wanted = periodsEndingAt(last.period, months);
  const byPeriod = new Map(sorted.map((o) => [o.period, o]));
  const rates: number[] = [];
  for (const p of wanted) {
    const obs = byPeriod.get(p);
    if (!obs) return null;
    rates.push(obs.monthlyRate);
  }
  return compose(rates);
}

/**
 * Cumul depuis le 1er janvier de l'année du dernier mois connu.
 *
 * Sémantique retenue pour « YTD » : le cumul des mois de **l'année civile en
 * cours**, de janvier au dernier mois publié. Ce n'est pas « les douze derniers
 * mois » — cette confusion est fréquente, et les deux nombres diffèrent dès que
 * l'année n'est pas terminée.
 *
 * `null` si un mois de l'année manque, ou si le dernier mois connu est janvier :
 * l'année n'a alors pas encore de cumul à montrer.
 */
export function cumulativeYearToDate(
  observations: readonly CpiObservation[]
): number | null {
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  if (!last) return null;

  const year = last.period.slice(0, 4);
  const monthsElapsed = Number(last.period.slice(5, 7));
  if (!Number.isFinite(monthsElapsed) || monthsElapsed < 2) return null;

  const rates: number[] = [];
  for (let m = 2; m <= monthsElapsed; m++) {
    /*
      Le cumul part de la fin décembre : janvier est la première variation
      comptée, et non le point de référence. Sans cela, l'inflation de janvier
      serait perdue.
    */
    const period = `${year}-${String(m).padStart(2, "0")}`;
    const obs = sorted.find((o) => o.period === period);
    if (!obs) return null;
    rates.push(obs.monthlyRate);
  }
  const janvier = sorted.find((o) => o.period === `${year}-01`);
  if (!janvier) return null;
  return compose([janvier.monthlyRate, ...rates]);
}

/**
 * Cumul de `years` variations annuelles publiées.
 *
 * Les glissements annuels officiels sont composés, jamais additionnés :
 * cinq années à 4 % font 21,67 %, pas 20 %.
 *
 * `null` si la profondeur manque — on ne complète pas une série annuelle par
 * une moyenne des autres.
 */
export function cumulativeOverYears(
  observations: readonly CpiYearlyObservation[],
  years: number
): number | null {
  if (years <= 0) return null;
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  if (sorted.length < years) return null;
  return compose(sorted.slice(-years).map((o) => o.yearlyRate));
}
