import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import {
  CL_PAYMENT_FREQUENCIES,
  CL_REPAYMENT_TYPES,
  CL_STATUSES,
  CL_STATUS_LABELS,
  type ClPaymentFrequency,
  type ClRepaymentType,
  type ClStatus,
  type CrowdlendingDto,
  type CrowdlendingSummary,
} from "./types";

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  const s = String(v ?? fallback).trim().replace(",", ".");
  const n = Number(s);
  return new Prisma.Decimal(Number.isFinite(n) ? s : fallback);
}

function n(v: string | number): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(raw: string | undefined): ClStatus {
  const s = String(raw || "ACTIVE").toUpperCase();
  if ((CL_STATUSES as readonly string[]).includes(s)) return s as ClStatus;
  return "ACTIVE";
}

function normalizeRepayment(raw: string | undefined): ClRepaymentType {
  const s = String(raw || "IN_FINE").toUpperCase();
  if ((CL_REPAYMENT_TYPES as readonly string[]).includes(s)) return s as ClRepaymentType;
  return "IN_FINE";
}

function normalizePaymentFrequency(raw: string | undefined): ClPaymentFrequency {
  const s = String(raw || "MONTHLY").toUpperCase();
  if ((CL_PAYMENT_FREQUENCIES as readonly string[]).includes(s)) {
    return s as ClPaymentFrequency;
  }
  return "MONTHLY";
}

/**
 * Capital restant dû effectif, avec repli.
 *
 * `remainingCapital` est un champ récent, par défaut à 0 en base — y
 * compris sur les lignes créées avant son ajout, jamais retouchées depuis.
 * Un 0 par défaut y signifierait « plus rien n'est dû », ce qui est faux
 * tant qu'aucun remboursement partiel n'a été saisi : le capital initial
 * reste investi. Le repli restitue donc `capitalInvested`, sauf ligne déjà
 * soldée (`REPAID`), où il n'y a effectivement plus rien à devoir.
 *
 * `interestReceivedToDate` n'a pas ce problème : son défaut à 0 est le fait
 * réel le plus probable pour une ligne neuve (rien encore perçu), donc il
 * est utilisé tel quel, sans repli, dans le reste de ce fichier.
 *
 * Exposé dans le DTO via `effectiveRemainingCapital` : l'UI consomme la
 * valeur résolue au lieu de réimplémenter la règle de son côté.
 */
export function effectiveRemainingCapital(
  capitalInvested: Prisma.Decimal,
  remainingCapital: Prisma.Decimal,
  status: ClStatus
): Prisma.Decimal {
  if (remainingCapital.gt(0)) return remainingCapital;
  if (status === "REPAID") return new Prisma.Decimal(0);
  return capitalInvested;
}

/**
 * `true` quand la valeur effective diffère de la valeur stockée, donc
 * qu'elle a été déduite et non saisie. Un prêt soldé stocké à 0 n'est pas
 * concerné : le repli renvoie 0 lui aussi, il n'y a aucune substitution à
 * signaler à l'utilisateur.
 */
function isRemainingCapitalDerived(
  remainingCapital: Prisma.Decimal,
  status: ClStatus
): boolean {
  return !remainingCapital.gt(0) && status !== "REPAID";
}

/**
 * Estimation simple des intérêts totaux sur la durée du prêt.
 *
 * In fine : le capital ne s'amortit pas avant l'échéance, les intérêts
 * courent sur le capital plein pendant toute la durée.
 * Amortissable : approximation par amortissement linéaire — le capital
 * moyen exposé sur la durée vaut la moitié du capital initial. Ce n'est pas
 * un échéancier réel (les intérêts d'un prêt amortissable dégressif sont en
 * réalité concentrés en début de vie), mais l'ordre de grandeur reste
 * pertinent pour comparer deux lignes entre elles.
 */
export function expectedTotalInterest(
  capitalInvested: Prisma.Decimal,
  annualYieldPercent: Prisma.Decimal,
  durationMonths: number,
  repaymentType: ClRepaymentType
): Prisma.Decimal {
  const years = new Prisma.Decimal(durationMonths).div(12);
  const avgCapital =
    repaymentType === "AMORTIZING" ? capitalInvested.div(2) : capitalInvested;
  return avgCapital.times(annualYieldPercent).div(100).times(years);
}

/** Months between now and maturity (can be negative if past) */
export function monthsUntil(maturity: Date | null, now = new Date()): number | null {
  if (!maturity) return null;
  const y = maturity.getFullYear() - now.getFullYear();
  const m = maturity.getMonth() - now.getMonth();
  let months = y * 12 + m;
  if (maturity.getDate() < now.getDate()) months -= 1;
  return months;
}

export function loanProgressPct(
  start: Date | null,
  maturity: Date | null,
  now = new Date()
): number | null {
  if (!start || !maturity) return null;
  const t0 = start.getTime();
  const t1 = maturity.getTime();
  if (t1 <= t0) return 100;
  const p = ((now.getTime() - t0) / (t1 - t0)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

type Row = Prisma.CrowdlendingPositionGetPayload<Record<string, never>>;

function mapRow(row: Row): CrowdlendingDto {
  const repaymentType = normalizeRepayment(row.repaymentType);
  const status = normalizeStatus(row.status);
  return {
    id: row.id,
    projectName: row.projectName,
    platform: row.platform,
    capitalInvested: row.capitalInvested.toString(),
    annualYieldPercent: row.annualYieldPercent.toString(),
    durationMonths: row.durationMonths,
    repaymentType,
    startDate: toIsoDate(row.startDate),
    maturityDate: toIsoDate(row.maturityDate),
    status,
    currency: row.currency,
    notes: row.notes,
    monthsRemaining: monthsUntil(row.maturityDate),
    progressPct: loanProgressPct(row.startDate, row.maturityDate),
    remainingCapital: row.remainingCapital.toString(),
    effectiveRemainingCapital: effectiveRemainingCapital(
      row.capitalInvested,
      row.remainingCapital,
      status
    ).toFixed(2),
    remainingCapitalIsDerived: isRemainingCapitalDerived(
      row.remainingCapital,
      status
    ),
    interestReceivedToDate: row.interestReceivedToDate.toString(),
    paymentFrequency: normalizePaymentFrequency(row.paymentFrequency),
    nextPaymentDate: toIsoDate(row.nextPaymentDate),
    riskGrade: row.riskGrade,
    expectedTotalInterest: expectedTotalInterest(
      row.capitalInvested,
      row.annualYieldPercent,
      row.durationMonths,
      repaymentType
    ).toFixed(2),
  };
}

/**
 * Prêt à échéance imminente : ACTIVE, échéance connue, ni déjà dépassée ni
 * au-delà de 3 mois. Règle identique à `rowFlags.soon` dans
 * alternatives-crowdlending.tsx — à garder synchronisée si l'une évolue.
 */
function isSoon(l: CrowdlendingDto): boolean {
  return (
    l.status === "ACTIVE" &&
    l.monthsRemaining != null &&
    l.monthsRemaining >= 0 &&
    l.monthsRemaining <= 3
  );
}

export function summarizeCrowdlending(lines: CrowdlendingDto[]): CrowdlendingSummary {
  let totalCapital = 0;
  let activeCapital = 0;
  let remainingCapitalTotal = 0;
  let interestReceivedTotal = 0;
  // Moyenne pondérée : accumulée en (poids × taux) / poids plutôt qu'en
  // moyenne de moyennes, pour qu'une grosse ligne pèse plus qu'une petite.
  let activeWeightedYieldSum = 0;
  let activeWeight = 0;
  let projectedAnnualIncome = 0;
  let soonCount = 0;
  const byStatus = new Map<string, { count: number; capital: number }>();

  for (const l of lines) {
    const cap = n(l.capitalInvested);
    totalCapital += cap;
    interestReceivedTotal += n(l.interestReceivedToDate);

    // Repli déjà résolu ligne à ligne par mapRow — une seule implémentation
    // de la règle, partagée par les agrégats et l'UI.
    const remaining = n(l.effectiveRemainingCapital);
    remainingCapitalTotal += remaining;

    const isActive = l.status === "ACTIVE" || l.status === "LATE";
    if (isActive) {
      activeCapital += cap;
      const yieldPct = n(l.annualYieldPercent);
      activeWeightedYieldSum += remaining * yieldPct;
      activeWeight += remaining;
      projectedAnnualIncome += (remaining * yieldPct) / 100;
    }

    if (isSoon(l)) soonCount += 1;

    const cur = byStatus.get(l.status) || { count: 0, capital: 0 };
    cur.count += 1;
    cur.capital += cap;
    byStatus.set(l.status, cur);
  }

  return {
    totalCapital: totalCapital.toFixed(2),
    activeCapital: activeCapital.toFixed(2),
    lineCount: lines.length,
    byStatus: [...byStatus.entries()].map(([status, v]) => ({
      status,
      label: CL_STATUS_LABELS[status as ClStatus] || status,
      count: v.count,
      capital: Math.round(v.capital * 100) / 100,
    })),
    weightedAverageYield:
      activeWeight > 0
        ? Math.round((activeWeightedYieldSum / activeWeight) * 100) / 100
        : null,
    projectedAnnualIncome: projectedAnnualIncome.toFixed(2),
    remainingCapitalTotal: remainingCapitalTotal.toFixed(2),
    interestReceivedTotal: interestReceivedTotal.toFixed(2),
    soonCount,
  };
}

export async function listCrowdlending(userId: string) {
  const rows = await prisma.crowdlendingPosition.findMany({
    where: { userId },
    orderBy: [{ maturityDate: "asc" }, { projectName: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizeCrowdlending(lines) };
}

export type CrowdlendingInput = {
  projectName: string;
  platform?: string | null;
  capitalInvested?: string | number;
  annualYieldPercent?: string | number;
  durationMonths?: string | number;
  repaymentType?: string;
  startDate?: string | null;
  maturityDate?: string | null;
  status?: string;
  currency?: string;
  notes?: string | null;
  remainingCapital?: string | number;
  interestReceivedToDate?: string | number;
  paymentFrequency?: string;
  nextPaymentDate?: string | null;
  riskGrade?: string | null;
};

function normalize(input: CrowdlendingInput) {
  const startDate = parseDate(input.startDate ?? null);
  let maturityDate = parseDate(input.maturityDate ?? null);
  const durationMonths = Math.max(
    0,
    Math.floor(Number(input.durationMonths ?? 12) || 12)
  );

  // Auto maturity from start + duration if missing
  if (!maturityDate && startDate && durationMonths > 0) {
    maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + durationMonths);
  }

  return {
    projectName: String(input.projectName || "").trim(),
    platform: input.platform ? String(input.platform).trim() : null,
    capitalInvested: dec(input.capitalInvested, "0"),
    annualYieldPercent: dec(input.annualYieldPercent, "0"),
    durationMonths,
    repaymentType: normalizeRepayment(input.repaymentType),
    startDate,
    maturityDate,
    status: normalizeStatus(input.status),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    notes: input.notes ? String(input.notes) : null,
    remainingCapital: dec(input.remainingCapital, "0"),
    interestReceivedToDate: dec(input.interestReceivedToDate, "0"),
    paymentFrequency: normalizePaymentFrequency(input.paymentFrequency),
    nextPaymentDate: parseDate(input.nextPaymentDate ?? null),
    riskGrade: input.riskGrade ? String(input.riskGrade).trim() : null,
  };
}

export async function createCrowdlending(userId: string, input: CrowdlendingInput) {
  const data = normalize(input);
  if (!data.projectName) throw new Error("Nom du projet requis");
  const row = await prisma.crowdlendingPosition.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updateCrowdlending(
  userId: string,
  id: string,
  input: Partial<CrowdlendingInput>
) {
  const existing = await prisma.crowdlendingPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");
  const data = normalize({
    projectName: input.projectName ?? existing.projectName,
    platform: input.platform !== undefined ? input.platform : existing.platform,
    capitalInvested: input.capitalInvested ?? existing.capitalInvested.toString(),
    annualYieldPercent:
      input.annualYieldPercent ?? existing.annualYieldPercent.toString(),
    durationMonths: input.durationMonths ?? existing.durationMonths,
    repaymentType: input.repaymentType ?? existing.repaymentType,
    startDate:
      input.startDate !== undefined ? input.startDate : toIsoDate(existing.startDate),
    maturityDate:
      input.maturityDate !== undefined
        ? input.maturityDate
        : toIsoDate(existing.maturityDate),
    status: input.status ?? existing.status,
    currency: input.currency ?? existing.currency,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    remainingCapital:
      input.remainingCapital ?? existing.remainingCapital.toString(),
    interestReceivedToDate:
      input.interestReceivedToDate ?? existing.interestReceivedToDate.toString(),
    paymentFrequency: input.paymentFrequency ?? existing.paymentFrequency,
    nextPaymentDate:
      input.nextPaymentDate !== undefined
        ? input.nextPaymentDate
        : toIsoDate(existing.nextPaymentDate),
    riskGrade: input.riskGrade !== undefined ? input.riskGrade : existing.riskGrade,
  });
  const write = await prisma.crowdlendingPosition.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Position introuvable");
  const row = await prisma.crowdlendingPosition.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Position introuvable");
  return mapRow(row);
}

export async function deleteCrowdlending(userId: string, id: string) {
  const result = await prisma.crowdlendingPosition.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Position introuvable");
  return { ok: true };
}
