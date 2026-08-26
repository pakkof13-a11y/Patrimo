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
  cumulativeSeries,
  periodOf,
  previousPeriod,
  type CpiCumulativePoint,
  type CpiObservation,
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
  deps?: { read?: () => Promise<CpiObservation[]> };
}): Promise<CpiSeriesResult> {
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
