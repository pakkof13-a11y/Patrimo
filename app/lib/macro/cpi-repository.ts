/**
 * Lecture des observations d'IPC, et construction de la courbe d'inflation.
 *
 * ## Une lecture ne collecte pas
 *
 * Ce dépôt n'appelle aucun fournisseur. Comme pour les cours, la collecte est
 * un travail à part : ce qui manque au cache manque à la réponse, et c'est dit.
 * Afficher un graphique ne doit pas déclencher un appel à l'INSEE.
 *
 * ## Aucune valeur n'est fabriquée
 *
 * Un mois absent fait disparaître la courbe, il ne la dégrade pas. La règle est
 * volontairement brutale : une composition amputée d'un mois n'est pas une
 * inflation approximative, c'est une autre grandeur. Mieux vaut « Inflation
 * indisponible » qu'un chiffre que personne ne peut recouper.
 */

import { prisma } from "../prisma";
import {
  compose,
  cumulativeSeries,
  periodOf,
  previousPeriod,
  type CpiCumulativePoint,
  type CpiObservation,
  type CpiYearlyObservation,
} from "./cpi";

/**
 * Source retenue, identifiable et unique.
 *
 * Une seule source par déploiement : mélanger l'IPC national de l'INSEE et
 * l'IPCH harmonisé d'Eurostat dans la même courbe produirait des ruptures que
 * rien n'expliquerait — ce sont deux indices, pas deux mesures du même.
 */
export const CPI_SOURCE = process.env.CPI_SOURCE?.trim() || "INSEE-BDM";

/** Observations disponibles pour la source configurée, triées. */
export async function readCpiObservations(): Promise<CpiObservation[]> {
  const rows = await prisma.cpiObservation.findMany({
    where: { source: CPI_SOURCE },
    orderBy: { period: "asc" },
    select: { period: true, monthlyRate: true },
  });
  return rows.map((r) => ({
    period: r.period,
    monthlyRate: Number(r.monthlyRate.toString()),
  }));
}

/**
 * Glissements annuels publiés, un par mois qui en porte un.
 *
 * Distincts des variations mensuelles : sur les fenêtres longues, c'est le
 * chiffre annuel officiel qui fait foi, et non une composition de douze mois
 * qui en approcherait la valeur sans la reproduire.
 */
export async function readCpiYearlyObservations(): Promise<CpiYearlyObservation[]> {
  const rows = await prisma.cpiObservation.findMany({
    where: { source: CPI_SOURCE, yearlyRate: { not: null } },
    orderBy: { period: "asc" },
    select: { period: true, yearlyRate: true },
  });
  return rows.map((r) => ({
    period: r.period,
    yearlyRate: Number(r.yearlyRate!.toString()),
  }));
}

/**
 * Un glissement annuel par année civile : celui de son dernier mois publié.
 *
 * L'INSEE publie un glissement annuel **chaque mois**. Les composer tous
 * reviendrait à compter soixante fois cinq ans d'inflation. Sur une fenêtre
 * pluriannuelle, on retient donc un chiffre par année — le plus récent qu'elle
 * porte — et on les compose.
 */
export function yearlyByCalendarYear(
  observations: readonly CpiYearlyObservation[]
): CpiYearlyObservation[] {
  const parAnnee = new Map<string, CpiYearlyObservation>();
  for (const o of [...observations].sort((a, b) => a.period.localeCompare(b.period))) {
    parAnnee.set(o.period.slice(0, 4), o);
  }
  return [...parAnnee.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, o]) => o);
}

/** Mois couverts par une fenêtre de dates, bornes comprises. */
export function periodsBetween(from: Date, to: Date): string[] {
  const first = periodOf(from);
  const out: string[] = [];
  let p = periodOf(to);
  // On remonte depuis la fin : la borne haute est toujours connue, la basse
  // peut précéder la première observation.
  for (let guard = 0; guard < 1200 && p >= first; guard++) {
    out.unshift(p);
    if (p === first) break;
    p = previousPeriod(p);
  }
  return out;
}

export type CpiSeriesResult =
  | { available: true; source: string; points: CpiCumulativePoint[] }
  | { available: false; reason: CpiUnavailableReason };

export type CpiUnavailableReason =
  /** Fenêtre trop courte : sous un mois, l'IPC n'a rien à dire. */
  | "window-too-short"
  /** Aucune observation en base pour cette source. */
  | "no-data"
  /** Un mois manque dans la fenêtre demandée. */
  | "incomplete";

/**
 * Nombre de mois minimal pour qu'une comparaison ait un sens.
 *
 * Deux : un mois de référence, et un mois de variation. En dessous, la courbe
 * serait un point, et l'afficher sur une fenêtre de sept jours laisserait
 * croire à une mesure hebdomadaire de l'inflation — qui n'existe pas.
 */
export const MIN_CPI_MONTHS = 2;

/**
 * Courbe d'inflation cumulée alignée sur une fenêtre.
 *
 * Le premier mois pose la référence à 0 % : c'est ce qui rend la série
 * directement comparable à la variation du portefeuille sur la même fenêtre,
 * sur un axe unique en pourcentage.
 */
export async function buildCpiSeries(opts: {
  from: Date;
  to: Date;
  /** Période demandée — c'est elle qui décide de la règle appliquée. */
  range?: string;
  deps?: {
    read?: () => Promise<CpiObservation[]>;
    readYearly?: () => Promise<CpiYearlyObservation[]>;
  };
}): Promise<CpiSeriesResult> {
  const rule = opts.range ? ruleForRange(opts.range) : "monthly";
  if (rule === "none") {
    return { available: false, reason: "window-too-short" };
  }

  if (rule === "yearly") {
    /*
      Fenêtres longues : les glissements annuels publiés font foi.

      Composer soixante variations mensuelles donnerait un nombre voisin, mais
      ce ne serait pas le chiffre que l'INSEE annonce et que l'utilisateur
      reconnaît. Sur cinq ans, l'écart entre les deux méthodes se voit.
    */
    const readYearly = opts.deps?.readYearly ?? readCpiYearlyObservations;
    const yearly = await readYearly();
    if (yearly.length === 0) return { available: false, reason: "no-data" };

    const points = yearlyCumulativeSeries(yearly, yearsForRange(opts.range!));
    if (!points) return { available: false, reason: "incomplete" };
    return { available: true, source: CPI_SOURCE, points };
  }

  const periods = periodsBetween(opts.from, opts.to);
  if (periods.length < MIN_CPI_MONTHS) {
    return { available: false, reason: "window-too-short" };
  }

  const read = opts.deps?.read ?? readCpiObservations;
  const observations = await read();
  if (observations.length === 0) {
    return { available: false, reason: "no-data" };
  }

  const points = cumulativeSeries(observations, periods);
  if (!points) return { available: false, reason: "incomplete" };

  return { available: true, source: CPI_SOURCE, points };
}

/**
 * Règle applicable à une fenêtre, telle que le chantier la définit.
 *
 * | Période | Règle |
 * |---|---|
 * | 7 J | aucune — l'IPC est mensuel |
 * | 1 M | dernier glissement mensuel |
 * | 3 M / 6 M / YTD | composition des mensuels |
 * | 1 A | dernier glissement **annuel** publié |
 * | 5 A | composition des cinq derniers **annuels** |
 *
 * La distinction 1 A / 5 A compte : une composition de douze ou soixante
 * mensuels approche le chiffre annuel sans le reproduire, et c'est le chiffre
 * officiel que l'utilisateur reconnaîtra.
 */
export type CpiRangeRule = "none" | "monthly" | "yearly";

export function ruleForRange(range: string): CpiRangeRule {
  switch (range) {
    case "7d":
      return "none";
    case "1y":
    case "5y":
    case "all":
      return "yearly";
    default:
      // 1m, 3m, 6m, ytd — et toute fenêtre courte à venir.
      return "monthly";
  }
}

/** Nombre d'années à composer pour une fenêtre annuelle. */
export function yearsForRange(range: string): number {
  if (range === "1y") return 1;
  if (range === "5y") return 5;
  return Number.POSITIVE_INFINITY; // "all" : tout ce qui est publié
}

/**
 * Courbe annuelle : un point par année, cumul composé des glissements publiés.
 *
 * Le premier point pose la référence à 0 %, comme la série mensuelle — les deux
 * échelles restent donc comparables à la variation du portefeuille sur la même
 * fenêtre.
 */
export function yearlyCumulativeSeries(
  yearly: readonly CpiYearlyObservation[],
  years: number
): CpiCumulativePoint[] | null {
  const parAnnee = yearlyByCalendarYear(yearly);
  if (parAnnee.length === 0) return null;

  const retenues = Number.isFinite(years) ? parAnnee.slice(-years) : parAnnee;
  if (Number.isFinite(years) && retenues.length < years) return null;

  const out: CpiCumulativePoint[] = [];
  const taux: number[] = [];

  /*
    Le point de départ est l'année qui précède la première retenue : sans lui,
    la courbe commencerait déjà au niveau du premier glissement, et la fenêtre
    afficherait une inflation avant d'avoir commencé.
  */
  const premiere = retenues[0]!;
  out.push({
    period: String(Number(premiere.period.slice(0, 4)) - 1),
    cumulative: 0,
    monthlyRate: 0,
  });

  for (const o of retenues) {
    taux.push(o.yearlyRate);
    out.push({
      period: o.period.slice(0, 4),
      cumulative: compose(taux),
      monthlyRate: o.yearlyRate,
    });
  }
  return out;
}
