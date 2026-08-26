/**
 * Service du P&L journalier par classe d'actif (vue « Décomposée » périodique).
 *
 * Volontairement **hors** de `getPortfolioHistory` : ce calcul peut déclencher
 * des appels fournisseurs pour remplir le cache de clôtures, et le dashboard
 * ne doit pas payer ce coût pour un panneau que l'utilisateur n'a peut-être
 * pas ouvert. Il est donc exposé par sa propre route, appelée à la demande.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { getDailyCloses } from "../market/daily-closes";
import {
  aggregateClassPnl,
  buildClassDailyPnl,
  buildDailyFlows,
  buildDailyQuantities,
  type ClassDailyInput,
  type ClassDailyPnl,
  type DayKey,
} from "./class-history";
import { mapDbTx } from "./service";

/** Garde-fou : ~5 ans de jours civils. */
const MAX_DAYS = 1900;

export type ClassPnlSeries = {
  points: ClassDailyPnl[];
  /** Classes présentes dans la série, triées par |P&L| cumulé décroissant. */
  classes: string[];
  /**
   * true si au moins un jour manque de cours pour une position détenue.
   * L'UI doit alors présenter les montants comme estimés.
   */
  estimated: boolean;
};

/** Liste inclusive des jours civils entre deux clés `YYYY-MM-DD`. */
export function enumerateDays(from: DayKey, to: DayKey): DayKey[] {
  if (!from || !to || from > to) return [];
  const out: DayKey[] = [];
  const [y0, m0, d0] = from.split("-").map(Number);
  const [y1, m1, d1] = to.split("-").map(Number);
  let t = Date.UTC(y0!, m0! - 1, d0!, 12);
  const end = Date.UTC(y1!, m1! - 1, d1!, 12);
  const dayMs = 24 * 60 * 60 * 1000;
  while (t <= end && out.length < MAX_DAYS) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate()
      ).padStart(2, "0")}`
    );
    t += dayMs;
  }
  return out;
}

/**
 * Série de P&L par classe sur une fenêtre de jours civils.
 *
 * L'isolation multi-tenant tient à deux endroits : les transactions **et** les
 * actifs sont lus filtrés sur `userId`, et le remplissage du cache de cours
 * passe par `getAssetPriceHistory`, qui revérifie l'appartenance de l'actif.
 */
export async function getClassPnlSeries(
  userId: string,
  fromDay: DayKey,
  toDay: DayKey,
  opts?: { bucketOf?: (day: DayKey) => string }
): Promise<ClassPnlSeries> {
  const days = enumerateDays(fromDay, toDay);
  if (days.length === 0) {
    return { points: [], classes: [], estimated: false };
  }

  const [txRows, assets] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    prisma.asset.findMany({
      where: { userId },
      select: { id: true, assetClass: true },
    }),
  ]);

  if (txRows.length === 0) {
    return { points: [], classes: [], estimated: false };
  }

  const classByAsset: Record<string, string> = {};
  for (const a of assets) classByAsset[a.id] = a.assetClass || "AUTRE";

  const ledgerTxs = txRows.map(mapDbTx);
  const quantities = buildDailyQuantities(ledgerTxs, days);
  const flows = buildDailyFlows(ledgerTxs);

  // Seuls les actifs réellement détenus sur la fenêtre méritent un cours.
  const heldAssetIds = new Set<string>();
  for (const day of days) {
    for (const [assetId, qty] of Object.entries(quantities.get(day) ?? {})) {
      if (qty !== 0) heldAssetIds.add(assetId);
    }
  }

  // Lecture seule — voir `performance-service` : la collecte appartient à la
  // tâche planifiée, pas à l'ouverture d'un écran.
  const { closes } = await getDailyCloses(
    userId,
    [...heldAssetIds],
    fromDay,
    toDay,
    { refresh: false }
  );

  const inputs: ClassDailyInput[] = days.map((day) => ({
    day,
    quantityByAsset: quantities.get(day) ?? {},
    netFlowByAsset: flows.get(day)?.netFlowByAsset,
    incomeByAsset: flows.get(day)?.incomeByAsset,
  }));

  const daily = buildClassDailyPnl(inputs, classByAsset, closes);
  const points = opts?.bucketOf
    ? aggregateClassPnl(daily, opts.bucketOf)
    : daily;

  // Classement des classes par poids, pour que l'empilement du graphique soit
  // stable et que les contributions dominantes soient lisibles en premier.
  const weight = new Map<string, number>();
  let estimated = false;
  for (const p of points) {
    if (p.incompleteClasses.length > 0) estimated = true;
    for (const [cls, v] of Object.entries(p.pnlByClass)) {
      weight.set(cls, (weight.get(cls) ?? 0) + Math.abs(v));
    }
  }
  const classes = [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls]) => cls);

  return { points, classes, estimated };
}

/** Fenêtre par défaut : `days` jours civils jusqu'à aujourd'hui (Paris) inclus. */
export function defaultWindow(days: number, now = new Date()): {
  fromDay: DayKey;
  toDay: DayKey;
} {
  const toDay = parisDayKey(now);
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { fromDay: parisDayKey(from), toDay };
}
