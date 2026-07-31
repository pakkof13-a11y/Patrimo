/**
 * Séries de performance des contrats d'assurance-vie.
 *
 * Le calcul réutilise la machinerie déjà en place pour le P&L par classe :
 * rejeu du ledger pour les quantités jour par jour, cache de clôtures pour les
 * cours. Rien n'est recalculé ici — une seconde chaîne de valorisation
 * finirait par diverger de la première, et c'est déjà arrivé sur ce dépôt.
 *
 * Ce que ce module ajoute est le découpage : les supports d'assurance-vie sont
 * regroupés **par contrat**, puis convertis en série pondérée par le temps
 * (voir `performance.ts`), afin qu'un versement ne passe jamais pour un gain.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { getDailyCloses } from "../market/daily-closes";
import {
  buildDailyFlows,
  buildDailyQuantities,
  closeAtOrBefore,
  type DayKey,
} from "../portfolio/class-history";
import { enumerateDays } from "../portfolio/class-pnl-service";
import { mapDbTx } from "../portfolio/service";
import {
  buildPerformanceSeries,
  performanceYtd,
  rangeStartDay,
  type PerfRange,
  type PerformancePoint,
} from "./performance";

export type ContractSeries = {
  /** `null` pour la série consolidée de l'enveloppe. */
  lifeInsuranceId: string | null;
  points: PerformancePoint[];
  /** Performance sur toute la fenêtre demandée, en %. */
  performancePct: number | null;
  /** Performance depuis le 1er janvier, en %. */
  ytdPct: number | null;
  /**
   * Part de l'encours effectivement couverte par un historique de cours, en %.
   *
   * Un support valorisé à la main — le cas de presque tous les fonds en euros —
   * n'a pas d'historique : sa valeur d'hier est inconnue, donc sa performance
   * aussi. Ces supports sont **exclus** de la courbe plutôt que comptés à zéro,
   * ce qui reviendrait à affirmer qu'ils n'ont rien rapporté. Le taux de
   * couverture dit à l'écran quelle part de l'épargne la courbe décrit
   * réellement — et `0` veut dire qu'il n'y a pas de courbe à montrer.
   */
  coveragePct: number;
  /** Encours couvert par des cours, en euros, au dernier jour de la fenêtre. */
  coveredValueEur: number;
  /** Encours sans historique, valorisé au montant investi. */
  uncoveredValueEur: number;
};

export type LifeInsurancePerformance = {
  range: PerfRange;
  fromDay: DayKey;
  toDay: DayKey;
  /** Enveloppe entière, tous contrats confondus. */
  total: ContractSeries;
  /** Une entrée par contrat portant au moins un support sur la fenêtre. */
  byContract: ContractSeries[];
};

/** Garde-fou : au-delà, la série est illisible et le calcul coûteux. */
const MAX_DAYS = 1900;

/**
 * Série de performance de l'enveloppe et de chaque contrat.
 *
 * `range = "all"` part de la première opération connue sur un support
 * d'assurance-vie : la seule borne qui ait un sens, et qu'aucune durée fixe ne
 * saurait deviner.
 */
export async function getLifeInsurancePerformance(
  userId: string,
  range: PerfRange,
  now = new Date()
): Promise<LifeInsurancePerformance> {
  const toDay = parisDayKey(now);

  // Les supports d'assurance-vie sont les actifs de l'enveloppe AV ; leur
  // contrat de rattachement vit sur la fiche support.
  const assets = await prisma.asset.findMany({
    where: { userId, accountType: "AV" },
    select: { id: true, lifeSupport: { select: { lifeInsuranceId: true } } },
  });

  const contractByAsset = new Map<string, string | null>(
    assets.map((a) => [a.id, a.lifeSupport?.lifeInsuranceId ?? null])
  );
  const avAssetIds = new Set(contractByAsset.keys());

  if (avAssetIds.size === 0) {
    return emptyResult(range, toDay);
  }

  const txRows = await prisma.transaction.findMany({
    where: { userId, assetId: { in: [...avAssetIds] } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  if (txRows.length === 0) {
    return emptyResult(range, toDay);
  }

  const firstDay = parisDayKey(txRows[0]!.occurredAt);
  const requested = rangeStartDay(range, now);
  // La fenêtre ne commence jamais avant la première opération : afficher deux
  // ans de plat avant l'ouverture du contrat ne renseigne sur rien.
  let fromDay = requested && requested > firstDay ? requested : firstDay;

  const span = enumerateDays(fromDay, toDay);
  const days = span.length > MAX_DAYS ? span.slice(span.length - MAX_DAYS) : span;
  if (days.length === 0) return emptyResult(range, toDay);
  fromDay = days[0]!;

  const ledgerTxs = txRows.map(mapDbTx);
  const quantities = buildDailyQuantities(ledgerTxs, days);
  const flows = buildDailyFlows(ledgerTxs);

  const heldAssetIds = new Set<string>();
  for (const day of days) {
    for (const [assetId, qty] of Object.entries(quantities.get(day) ?? {})) {
      if (qty !== 0 && avAssetIds.has(assetId)) heldAssetIds.add(assetId);
    }
  }

  const { closes } = await getDailyCloses(
    userId,
    [...heldAssetIds],
    fromDay,
    toDay
  );

  /**
   * Un support n'entre dans la courbe que s'il a un historique. Les autres —
   * fonds en euros valorisés à la main, UC sans cotation — sont comptés à part,
   * au montant investi, pour dire quelle part de l'épargne échappe à la mesure.
   */
  const covered = new Set(
    [...heldAssetIds].filter((id) => (closes.get(id)?.size ?? 0) > 0)
  );

  /** Un seau de valeurs et de flux journaliers par contrat, plus le total. */
  type Bucket = {
    values: Map<DayKey, number>;
    netFlows: Map<DayKey, number>;
    /** Cumul des flux des supports sans historique — leur montant investi. */
    uncoveredBookValue: number;
  };
  const buckets = new Map<string | null, Bucket>();
  const bucketFor = (key: string | null): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { values: new Map(), netFlows: new Map(), uncoveredBookValue: 0 };
      buckets.set(key, b);
    }
    return b;
  };
  const total = bucketFor(null);

  for (const day of days) {
    const qtyByAsset = quantities.get(day) ?? {};
    const flowsOfDay = flows.get(day)?.netFlowByAsset ?? {};

    // Chaque seau doit avoir un point par jour, même nul : sans cela, un
    // contrat sans mouvement disparaîtrait de la courbe ces jours-là.
    for (const b of buckets.values()) {
      if (!b.values.has(day)) b.values.set(day, 0);
    }

    for (const [assetId, qty] of Object.entries(qtyByAsset)) {
      if (!covered.has(assetId) || qty === 0) continue;
      const b = bucketFor(contractByAsset.get(assetId) ?? null);
      if (!b.values.has(day)) b.values.set(day, 0);
      const close = closeAtOrBefore(closes.get(assetId), day);
      // Trou ponctuel dans une série par ailleurs connue : la clôture est
      // reportée depuis le dernier jour coté, jamais devinée vers l'avenir.
      if (close == null) continue;
      const value = qty * close;
      b.values.set(day, (b.values.get(day) ?? 0) + value);
      total.values.set(day, (total.values.get(day) ?? 0) + value);
    }

    for (const [assetId, flow] of Object.entries(flowsOfDay)) {
      if (!covered.has(assetId) || flow === 0) continue;
      const b = bucketFor(contractByAsset.get(assetId) ?? null);
      b.netFlows.set(day, (b.netFlows.get(day) ?? 0) + flow);
      total.netFlows.set(day, (total.netFlows.get(day) ?? 0) + flow);
    }
  }

  /*
    Encours sans historique, au montant investi.

    Il se cumule depuis **la première opération**, et non sur la seule fenêtre
    affichée : un fonds euro versé il y a trois ans ne produit aucun flux ce
    mois-ci, et le compter sur la fenêtre ferait passer la couverture pour
    100 % alors que la courbe ignore la moitié de l'épargne.
  */
  for (const [day, entry] of flows) {
    if (day > toDay) continue;
    for (const [assetId, flow] of Object.entries(entry.netFlowByAsset)) {
      if (!avAssetIds.has(assetId) || covered.has(assetId) || flow === 0) {
        continue;
      }
      const b = bucketFor(contractByAsset.get(assetId) ?? null);
      b.uncoveredBookValue += flow;
      total.uncoveredBookValue += flow;
    }
  }

  const lastDay = days[days.length - 1]!;

  const toSeries = (key: string | null, b: Bucket): ContractSeries => {
    const coveredValueEur = b.values.get(lastDay) ?? 0;
    const uncoveredValueEur = Math.max(0, b.uncoveredBookValue);
    const base = coveredValueEur + uncoveredValueEur;
    const coveragePct = base > 0 ? (coveredValueEur / base) * 100 : 0;

    // Aucune couverture : il n'y a pas de courbe plate à montrer, il n'y a pas
    // de courbe. Rendre une série à 0 % laisserait croire à un contrat inerte.
    if (coveredValueEur <= 0) {
      return {
        lifeInsuranceId: key,
        points: [],
        performancePct: null,
        ytdPct: null,
        coveragePct: 0,
        coveredValueEur: 0,
        uncoveredValueEur,
      };
    }

    const points = buildPerformanceSeries(
      days.map((day) => ({
        day,
        valueEur: b.values.get(day) ?? 0,
        netFlowEur: b.netFlows.get(day) ?? 0,
      }))
    );
    const first = points[0];
    const last = points[points.length - 1];

    return {
      lifeInsuranceId: key,
      points,
      performancePct:
        first && last && first.index > 0 && points.length > 1
          ? (last.index / first.index - 1) * 100
          : null,
      ytdPct: performanceYtd(points),
      coveragePct,
      coveredValueEur,
      uncoveredValueEur,
    };
  };

  return {
    range,
    fromDay,
    toDay,
    total: toSeries(null, total),
    byContract: [...buckets.entries()]
      .filter(([key]) => key !== null)
      .map(([key, b]) => toSeries(key, b)),
  };
}

function emptyResult(range: PerfRange, toDay: DayKey): LifeInsurancePerformance {
  return {
    range,
    fromDay: toDay,
    toDay,
    total: {
      lifeInsuranceId: null,
      points: [],
      performancePct: null,
      ytdPct: null,
      coveragePct: 0,
      coveredValueEur: 0,
      uncoveredValueEur: 0,
    },
    byContract: [],
  };
}
