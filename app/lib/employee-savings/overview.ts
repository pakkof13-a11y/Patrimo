/**
 * Agrégats de la vue d'ensemble « Épargne salariale ».
 *
 * Fonctions pures : elles prennent les lignes rendues par `/api/employee-savings`
 * et produisent ce que l'écran affiche.
 *
 * Deux principes gouvernent tout ce fichier :
 *
 * 1. **Une ligne n'est pas un plan.** Le modèle stocke des lots de FCPE ; un
 *    plan d'épargne est l'ensemble des lots d'un même type chez un même
 *    gestionnaire. C'est ce regroupement — et lui seul — qui donne les cartes.
 * 2. **Ce que la valeur ne dit pas.** `parts × VL` donne ce que la position
 *    vaut aujourd'hui, jamais ce qu'elle a coûté. Sans montant versé, il n'y a
 *    ni gain ni performance : ces mesures ressortent à `null` plutôt qu'à zéro,
 *    et l'écran l'annonce.
 */

import {
  FUND_CATEGORY_LABELS,
  FUND_CATEGORY_ORDER,
  resolveFundCategory,
  type FundCategory,
} from "./fund-category";
import { PLAN_TYPE_LABELS, SOURCE_TYPE_LABELS } from "./types";

/** Ligne telle que rendue par l'API. */
export type OverviewLine = {
  id: string;
  planType: string;
  manager: string;
  fundName: string;
  fundCategory?: string | null;
  units: string;
  nav: string;
  currency: string;
  sourceType: string;
  contributionDate: string | null;
  contributedAmount?: string | null;
  unlockDate: string | null;
  unlockMode: string;
  marketValue: string;
  liquidityStatus: "AVAILABLE" | "BLOCKED";
  unlockLabel: string;
};

export function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function has(v: string | number | null | undefined): boolean {
  return v != null && String(v).trim() !== "";
}

/* ── Totaux ───────────────────────────────────────────────────────── */

export type OverviewTotals = {
  totalValue: number;
  availableValue: number;
  blockedValue: number;
  /** Part disponible, `null` si l'encours est nul. */
  availablePct: number | null;
  /**
   * Versements déclarés. `null` tant qu'aucune ligne ne porte de montant :
   * zéro se lirait « rien versé », ce qui est faux pour une épargne existante.
   */
  contributed: number | null;
  /** Valeur − versements, `null` pour la même raison. */
  gain: number | null;
  /** Rapporté aux versements, en %. */
  gainPct: number | null;
  /** Lignes dont le montant versé manque — l'écran chiffre l'incomplétude. */
  linesMissingContribution: number;
  lineCount: number;
  planCount: number;
};

export function computeTotals(lines: OverviewLine[]): OverviewTotals {
  let totalValue = 0;
  let availableValue = 0;
  let contributed = 0;
  let withContribution = 0;

  for (const l of lines) {
    const v = num(l.marketValue);
    totalValue += v;
    if (l.liquidityStatus === "AVAILABLE") availableValue += v;
    if (has(l.contributedAmount)) {
      contributed += num(l.contributedAmount);
      withContribution += 1;
    }
  }

  const hasContributions = withContribution > 0;
  const gain = hasContributions ? totalValue - contributed : null;

  return {
    totalValue,
    availableValue,
    blockedValue: totalValue - availableValue,
    availablePct: totalValue > 0 ? (availableValue / totalValue) * 100 : null,
    contributed: hasContributions ? contributed : null,
    gain,
    gainPct: gain != null && contributed > 0 ? (gain / contributed) * 100 : null,
    linesMissingContribution: lines.length - withContribution,
    lineCount: lines.length,
    planCount: groupIntoPlans(lines).length,
  };
}

/* ── Répartition par famille de support ───────────────────────────── */

export type CategorySlice = {
  category: FundCategory;
  label: string;
  value: number;
  /** Part de l'encours, `null` si l'encours est nul. */
  sharePct: number | null;
  lineCount: number;
  /** true si au moins une ligne de la part a été déduite du nom du fonds. */
  hasInferred: boolean;
};

/**
 * Répartition de l'encours par famille de fonds.
 *
 * L'ordre est fixe (actions → diversifiés → obligataires → monétaires →
 * autres) : il va du plus exposé au moins exposé, ce qui se lit comme une
 * échelle de risque, et il garde la même couleur au même endroit d'un plan à
 * l'autre.
 */
export function computeAllocation(lines: OverviewLine[]): CategorySlice[] {
  const acc = new Map<
    FundCategory,
    { value: number; lineCount: number; hasInferred: boolean }
  >();
  let total = 0;

  for (const l of lines) {
    const { category, source } = resolveFundCategory(l);
    const value = num(l.marketValue);
    const cur = acc.get(category) ?? {
      value: 0,
      lineCount: 0,
      hasInferred: false,
    };
    cur.value += value;
    cur.lineCount += 1;
    cur.hasInferred = cur.hasInferred || source !== "declared";
    acc.set(category, cur);
    total += value;
  }

  return FUND_CATEGORY_ORDER.filter((c) => acc.has(c)).map((category) => {
    const entry = acc.get(category)!;
    return {
      category,
      label: FUND_CATEGORY_LABELS[category],
      value: entry.value,
      sharePct: total > 0 ? (entry.value / total) * 100 : null,
      lineCount: entry.lineCount,
      hasInferred: entry.hasInferred,
    };
  });
}

/* ── Plans ────────────────────────────────────────────────────────── */

export type PlanView = {
  /** `PEE·Amundi` — stable, sert de clé de rendu et d'ancre. */
  key: string;
  planType: string;
  /** « Plan d'épargne entreprise » — le nom long, pas le sigle. */
  title: string;
  /** Sigle : PEE, PER, PERCO. */
  shortLabel: string;
  manager: string;
  value: number;
  contributed: number | null;
  gain: number | null;
  gainPct: number | null;
  allocation: CategorySlice[];
  availableValue: number;
  blockedValue: number;
  /** Versements de l'année civile en cours, `null` si aucun montant connu. */
  contributedThisYear: number | null;
  /** Prochaine date de déblocage à venir, tous lots confondus. */
  nextUnlockDate: string | null;
  /** true si au moins un lot est bloqué jusqu'à la retraite. */
  hasRetirementLock: boolean;
  lines: OverviewLine[];
};

/**
 * Nom long d'un plan. `PLAN_TYPE_LABELS` porte « PEE — Plan d'épargne
 * entreprise » ; la carte affiche le libellé, la pastille le sigle, et
 * répéter le sigle des deux côtés n'apprendrait rien.
 */
export function planTitle(planType: string): string {
  const label = PLAN_TYPE_LABELS[planType as keyof typeof PLAN_TYPE_LABELS];
  if (!label) return planType;
  const dash = label.indexOf("—");
  return dash >= 0 ? label.slice(dash + 1).trim() : label;
}

/**
 * Regroupe les lots en plans : un plan = un type d'enveloppe chez un
 * gestionnaire. Deux PEE chez deux gestionnaires restent deux plans, ce qui
 * est le cas d'un salarié ayant changé d'employeur.
 */
export function groupIntoPlans(
  lines: OverviewLine[],
  now = new Date()
): PlanView[] {
  const groups = new Map<string, OverviewLine[]>();
  for (const l of lines) {
    const key = `${l.planType}·${l.manager}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(l);
    else groups.set(key, [l]);
  }

  const year = now.getFullYear();
  const today = now.getTime();

  const plans: PlanView[] = [];
  for (const [key, group] of groups) {
    let value = 0;
    let contributed = 0;
    let withContribution = 0;
    let contributedThisYear = 0;
    let availableValue = 0;
    let hasRetirementLock = false;
    let nextUnlock: number | null = null;

    for (const l of group) {
      const v = num(l.marketValue);
      value += v;
      if (l.liquidityStatus === "AVAILABLE") availableValue += v;
      if (has(l.contributedAmount)) {
        const amount = num(l.contributedAmount);
        contributed += amount;
        withContribution += 1;
        const t = l.contributionDate ? Date.parse(l.contributionDate) : NaN;
        if (Number.isFinite(t) && new Date(t).getFullYear() === year) {
          contributedThisYear += amount;
        }
      }
      if (l.unlockMode === "RETIREMENT") hasRetirementLock = true;
      const u = l.unlockDate ? Date.parse(l.unlockDate) : NaN;
      if (Number.isFinite(u) && u > today && (nextUnlock == null || u < nextUnlock)) {
        nextUnlock = u;
      }
    }

    const gain = withContribution > 0 ? value - contributed : null;
    const first = group[0]!;

    plans.push({
      key,
      planType: first.planType,
      title: planTitle(first.planType),
      shortLabel: first.planType,
      manager: first.manager,
      value,
      contributed: withContribution > 0 ? contributed : null,
      gain,
      gainPct: gain != null && contributed > 0 ? (gain / contributed) * 100 : null,
      allocation: computeAllocation(group),
      availableValue,
      blockedValue: value - availableValue,
      contributedThisYear: withContribution > 0 ? contributedThisYear : null,
      nextUnlockDate: nextUnlock != null ? new Date(nextUnlock).toISOString() : null,
      hasRetirementLock,
      lines: group,
    });
  }

  // Du plus gros au plus petit encours ; à encours égal, l'ordre alphabétique
  // garde un affichage stable d'un chargement à l'autre.
  return plans.sort(
    (a, b) => b.value - a.value || a.key.localeCompare(b.key, "fr")
  );
}

/* ── Versements cumulés ───────────────────────────────────────────── */

export type ContributionPoint = {
  /** `YYYY-MM-DD` */
  day: string;
  /** Versements cumulés à cette date, en euros. */
  cumulative: number;
  /** Versement du jour, en euros. */
  amount: number;
};

/**
 * Courbe des versements cumulés.
 *
 * C'est la seule série datée que le modèle possède : chaque lot porte sa date
 * et son montant. Elle ne prétend pas être une valorisation historique — les
 * VL passées ne sont nulle part — mais elle montre ce qui a été **mis**, et
 * l'écart avec la valeur d'aujourd'hui se lit d'un coup d'œil.
 *
 * Les lots sans date ou sans montant sont ignorés : leur placer une date
 * arbitraire déplacerait la courbe sans que rien ne le justifie.
 */
export function buildContributionSeries(
  lines: OverviewLine[]
): ContributionPoint[] {
  const byDay = new Map<string, number>();

  for (const l of lines) {
    if (!has(l.contributedAmount) || !l.contributionDate) continue;
    const t = Date.parse(l.contributionDate);
    if (!Number.isFinite(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + num(l.contributedAmount));
  }

  let cumulative = 0;
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, amount]) => {
      cumulative += amount;
      return { day, cumulative, amount };
    });
}

export const ES_RANGES = ["1m", "ytd", "1y", "3y", "5y", "all"] as const;
export type EsRange = (typeof ES_RANGES)[number];

export const ES_RANGE_LABEL: Record<EsRange, string> = {
  "1m": "1M",
  ytd: "YTD",
  "1y": "1A",
  "3y": "3A",
  "5y": "5A",
  all: "Tout",
};

export function isEsRange(v: string): v is EsRange {
  return (ES_RANGES as readonly string[]).includes(v);
}

/**
 * Fenêtre d'affichage d'une série.
 *
 * Le premier point conservé est celui qui précède la borne, quand il existe :
 * sans lui, la courbe démarrerait à zéro et laisserait croire que l'épargne
 * a été constituée pendant la fenêtre.
 */
export function sliceSeries(
  points: ContributionPoint[],
  range: EsRange,
  now = new Date()
): ContributionPoint[] {
  if (range === "all" || points.length === 0) return points;

  const from = rangeStartDay(range, now);
  if (!from) return points;

  const firstInside = points.findIndex((p) => p.day >= from);
  if (firstInside <= 0) return firstInside === 0 ? points : [];
  return points.slice(firstInside - 1);
}

export function rangeStartDay(range: EsRange, now: Date): string | null {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (range) {
    case "1m":
      return shiftMonths(now, -1);
    case "ytd":
      return `${now.getUTCFullYear()}-01-01`;
    case "1y":
      return shiftMonths(now, -12);
    case "3y":
      return shiftMonths(now, -36);
    case "5y":
      return shiftMonths(now, -60);
    case "all":
      return null;
    default:
      return iso(now);
  }
}

/**
 * Recule de `months` mois en bornant au dernier jour du mois d'arrivée : le
 * 31 juillet moins un mois donne le 30 juin, pas le 1er juillet.
 */
function shiftMonths(now: Date, months: number): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + months;
  const day = now.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/* ── Disponibilités et échéances ──────────────────────────────────── */

export type NextUnlock = {
  dateIso: string;
  daysAway: number;
  amount: number;
  lineCount: number;
};

/**
 * Prochaine échéance de déblocage, tous plans confondus.
 *
 * Rend `null` quand il n'y en a pas : soit tout est déjà disponible, soit tout
 * est bloqué jusqu'à la retraite — deux situations qu'une date inventée
 * masquerait.
 */
export function nextUnlock(
  lines: OverviewLine[],
  now = new Date()
): NextUnlock | null {
  const today = now.getTime();
  let best: number | null = null;
  let amount = 0;
  let lineCount = 0;

  for (const l of lines) {
    const t = l.unlockDate ? Date.parse(l.unlockDate) : NaN;
    if (!Number.isFinite(t) || t <= today) continue;
    if (best == null || t < best) {
      best = t;
      amount = num(l.marketValue);
      lineCount = 1;
    } else if (t === best) {
      amount += num(l.marketValue);
      lineCount += 1;
    }
  }

  if (best == null) return null;
  return {
    dateIso: new Date(best).toISOString(),
    daysAway: Math.max(0, Math.ceil((best - today) / (24 * 3600 * 1000))),
    amount,
    lineCount,
  };
}

/* ── Dernières opérations ─────────────────────────────────────────── */

export type RecentContribution = {
  id: string;
  dateIso: string;
  label: string;
  sourceLabel: string;
  planLabel: string;
  /** Montant versé, `null` si la ligne ne le porte pas. */
  amount: number | null;
};

/**
 * Derniers versements connus, du plus récent au plus ancien.
 *
 * Ce sont les lots eux-mêmes : le modèle n'a pas de journal d'opérations, et
 * chaque lot *est* un versement daté. Un lot sans date n'apparaît pas — le
 * placer en tête ou en queue serait une invention dans les deux cas.
 */
export function recentContributions(
  lines: OverviewLine[],
  limit = 5
): RecentContribution[] {
  return lines
    .filter((l) => l.contributionDate && Number.isFinite(Date.parse(l.contributionDate)))
    .sort(
      (a, b) =>
        Date.parse(b.contributionDate!) - Date.parse(a.contributionDate!)
    )
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      dateIso: new Date(Date.parse(l.contributionDate!)).toISOString(),
      label: l.fundName,
      sourceLabel:
        SOURCE_TYPE_LABELS[l.sourceType as keyof typeof SOURCE_TYPE_LABELS] ??
        l.sourceType,
      planLabel: `${l.planType} · ${l.manager}`,
      amount: has(l.contributedAmount) ? num(l.contributedAmount) : null,
    }));
}
