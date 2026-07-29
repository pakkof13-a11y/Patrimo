import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import type { PeType, PrivateEquityDto, PrivateEquitySummary } from "./types";
import { PE_TYPES } from "./types";

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  const s = String(v ?? fallback).trim().replace(",", ".");
  const n = Number(s);
  return new Prisma.Decimal(Number.isFinite(n) ? s : fallback);
}

function n(v: string | number): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

/** Decimal optionnel : `null`/vide reste `null`, ne devient pas zéro. */
function optDec(v: string | number | undefined | null): Prisma.Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return dec(v);
}

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Mois pleins écoulés entre `from` et `now` (>= 0, jamais négatif). */
function monthsSince(from: Date, now = new Date()): number {
  const y = now.getFullYear() - from.getFullYear();
  const m = now.getMonth() - from.getMonth();
  let months = y * 12 + m;
  if (now.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * NAV périmée : pas de `navUpdatedAt` (jamais renseigné, cas défensif —
 * `updatedAt` Prisma est en pratique toujours présent) ou datant de plus de
 * 6 mois. `navUpdatedAt` est un proxy de la date de dernière NAV (dérivé de
 * `updatedAt`, faute de champ dédié) : toute modification de la ligne le
 * rafraîchit, pas seulement `currentNav`.
 */
export function isNavStale(
  navUpdatedAt: string | null,
  now = new Date()
): boolean {
  if (!navUpdatedAt) return true;
  const updated = new Date(navUpdatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  return monthsSince(updated, now) > 6;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePeType(raw: string | undefined): PeType {
  const s = String(raw || "DIRECT").toUpperCase();
  if ((PE_TYPES as readonly string[]).includes(s)) return s as PeType;
  return "DIRECT";
}

/**
 * Capital appelé effectif, avec repli.
 *
 * `calledCapital` est un champ récent, à 0 par défaut — y compris sur les
 * lignes existantes et sur toute ligne créée sans saisie explicite d'appels
 * échelonnés (mode simple). Le repli restitue shares × PRU : c'est
 * exactement le montant que `investedTotal` désignait déjà comme capital
 * investi avant que la notion d'appel de capital n'existe. Jamais écrit en
 * base à la création ni en backfill sur les lignes existantes (voir
 * `normalize` plus bas) : figer une valeur dérivée au moment T romprait le
 * suivi si l'utilisateur corrige `shares` par la suite, ce qui recréerait
 * précisément la confusion que le repli cherche à éviter.
 */
function effectiveCalledCapital(
  calledCapital: Prisma.Decimal,
  shares: Prisma.Decimal,
  acquisitionPricePerShare: Prisma.Decimal
): Prisma.Decimal {
  if (calledCapital.gt(0)) return calledCapital;
  return shares.times(acquisitionPricePerShare);
}

type Row = Prisma.PrivateEquityPositionGetPayload<Record<string, never>>;

/** Exporté pour être testé directement (dpi/rvpi/tvpi/pnl, repli calledCapital). */
export function mapRow(row: Row): PrivateEquityDto {
  const shares = n(row.shares.toString());
  const pru = n(row.acquisitionPricePerShare.toString());
  const nav = n(row.currentNav.toString());
  const invested = shares * pru;
  const pnl = nav - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  const called = effectiveCalledCapital(
    row.calledCapital,
    row.shares,
    row.acquisitionPricePerShare
  );
  const calledN = n(called.toString());
  const distributions = n(row.distributionsReceived.toString());
  // null plutôt que 0 : sans base de calcul, un ratio à 0 laisserait croire
  // à une performance nulle sur un investissement réel, alors qu'il n'y a
  // simplement rien à diviser.
  const dpi = calledN > 0 ? distributions / calledN : null;
  const rvpi = calledN > 0 ? nav / calledN : null;
  const tvpi = calledN > 0 ? (nav + distributions) / calledN : null;

  return {
    id: row.id,
    companyName: row.companyName,
    sector: row.sector,
    peType: normalizePeType(row.peType),
    shares: row.shares.toString(),
    acquisitionPricePerShare: row.acquisitionPricePerShare.toString(),
    investmentDate: toIsoDate(row.investmentDate),
    currentNav: row.currentNav.toString(),
    currency: row.currency,
    notes: row.notes,
    investedTotal: invested.toFixed(2),
    // alias rétrocompatible de tvpi ; "0.00" (jamais null) quand non calculable
    moic: (tvpi ?? 0).toFixed(2),
    unrealizedPnl: pnl.toFixed(2),
    unrealizedPnlPct: pnlPct.toFixed(2),
    committedCapital: row.committedCapital.toString(),
    calledCapital: row.calledCapital.toString(),
    calledCapitalIsDerived: !row.calledCapital.gt(0),
    distributionsReceived: row.distributionsReceived.toString(),
    dpi: dpi !== null ? dpi.toFixed(4) : null,
    rvpi: rvpi !== null ? rvpi.toFixed(4) : null,
    tvpi: tvpi !== null ? tvpi.toFixed(4) : null,
    ownershipPercent: row.ownershipPercent !== null ? row.ownershipPercent.toString() : null,
    expectedExitDate: toIsoDate(row.expectedExitDate),
    vehicleName: row.vehicleName,
    round: row.round,
    navUpdatedAt: toIsoDate(row.updatedAt),
  };
}

export function summarizePrivateEquity(
  lines: PrivateEquityDto[],
  now = new Date()
): PrivateEquitySummary {
  let totalInvested = 0;
  let totalNav = 0;
  let totalCalledCapital = 0;
  let totalDistributions = 0;
  let staleNavCount = 0;
  for (const l of lines) {
    totalInvested += n(l.investedTotal);
    totalNav += n(l.currentNav);
    // Repli déjà résolu ligne à ligne par mapRow : calledCapitalIsDerived
    // indique que la valeur brute est 0 et que investedTotal (shares × PRU)
    // sert de valeur effective — évite de recalculer le repli ici.
    totalCalledCapital += l.calledCapitalIsDerived ? n(l.investedTotal) : n(l.calledCapital);
    totalDistributions += n(l.distributionsReceived);
    if (isNavStale(l.navUpdatedAt, now)) staleNavCount += 1;
  }
  const avgMoic = totalInvested > 0 ? Math.round((totalNav / totalInvested) * 100) / 100 : 0;
  // Agrégation dollar-pondérée : somme des numérateurs / somme des
  // dénominateurs, équivalente à une moyenne pondérée par calledCapital
  // ligne à ligne (dpi_i × called_i = distributions_i).
  const avgDpi =
    totalCalledCapital > 0
      ? Math.round((totalDistributions / totalCalledCapital) * 10000) / 10000
      : null;
  const avgRvpi =
    totalCalledCapital > 0
      ? Math.round((totalNav / totalCalledCapital) * 10000) / 10000
      : null;
  const avgTvpi =
    totalCalledCapital > 0
      ? Math.round(((totalNav + totalDistributions) / totalCalledCapital) * 10000) / 10000
      : null;
  return {
    totalInvested: totalInvested.toFixed(2),
    totalNav: totalNav.toFixed(2),
    totalPnl: (totalNav - totalInvested).toFixed(2),
    avgMoic,
    lineCount: lines.length,
    totalCalledCapital: totalCalledCapital.toFixed(2),
    totalDistributions: totalDistributions.toFixed(2),
    avgDpi,
    avgRvpi,
    avgTvpi,
    staleNavCount,
  };
}

export async function listPrivateEquity(userId: string) {
  const rows = await prisma.privateEquityPosition.findMany({
    where: { userId },
    orderBy: [{ companyName: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizePrivateEquity(lines) };
}

export type PrivateEquityInput = {
  companyName: string;
  sector?: string | null;
  peType?: string;
  shares?: string | number;
  acquisitionPricePerShare?: string | number;
  investmentDate?: string | null;
  currentNav?: string | number;
  currency?: string;
  notes?: string | null;
  committedCapital?: string | number;
  calledCapital?: string | number;
  distributionsReceived?: string | number;
  ownershipPercent?: string | number | null;
  expectedExitDate?: string | null;
  vehicleName?: string | null;
  round?: string | null;
};

function normalize(input: PrivateEquityInput) {
  const shares = dec(input.shares, "0");
  const acquisitionPricePerShare = dec(input.acquisitionPricePerShare, "0");
  // À la création, si l'appelant ne fournit pas calledCapital, on
  // l'initialise une seule fois avec shares × PRU plutôt que de le laisser
  // à 0 — écriture ponctuelle à la création, pas de backfill sur les lignes
  // existantes. updatePrivateEquity fournit toujours une valeur déjà
  // résolue (voir plus bas), donc cette branche ne se déclenche jamais en
  // update : la valeur stockée, y compris 0, est toujours respectée telle
  // quelle. Le repli en lecture (`effectiveCalledCapital`) reste
  // nécessaire pour les lignes créées avant ce changement.
  const calledCapital =
    input.calledCapital !== undefined
      ? dec(input.calledCapital, "0")
      : shares.times(acquisitionPricePerShare);
  return {
    companyName: String(input.companyName || "").trim(),
    sector: input.sector ? String(input.sector).trim() : null,
    peType: normalizePeType(input.peType),
    shares,
    acquisitionPricePerShare,
    investmentDate: parseDate(input.investmentDate ?? null),
    currentNav: dec(input.currentNav, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    notes: input.notes ? String(input.notes) : null,
    committedCapital: dec(input.committedCapital, "0"),
    calledCapital,
    distributionsReceived: dec(input.distributionsReceived, "0"),
    ownershipPercent: optDec(input.ownershipPercent),
    expectedExitDate: parseDate(input.expectedExitDate ?? null),
    vehicleName: input.vehicleName ? String(input.vehicleName).trim() : null,
    round: input.round ? String(input.round).trim() : null,
  };
}

export async function createPrivateEquity(userId: string, input: PrivateEquityInput) {
  const data = normalize(input);
  if (!data.companyName) throw new Error("Nom de la société requis");
  const row = await prisma.privateEquityPosition.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updatePrivateEquity(
  userId: string,
  id: string,
  input: Partial<PrivateEquityInput>
) {
  const existing = await prisma.privateEquityPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");
  const data = normalize({
    companyName: input.companyName ?? existing.companyName,
    sector: input.sector !== undefined ? input.sector : existing.sector,
    peType: input.peType ?? existing.peType,
    shares: input.shares ?? existing.shares.toString(),
    acquisitionPricePerShare:
      input.acquisitionPricePerShare ?? existing.acquisitionPricePerShare.toString(),
    investmentDate:
      input.investmentDate !== undefined
        ? input.investmentDate
        : toIsoDate(existing.investmentDate),
    currentNav: input.currentNav ?? existing.currentNav.toString(),
    currency: input.currency ?? existing.currency,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    committedCapital: input.committedCapital ?? existing.committedCapital.toString(),
    calledCapital: input.calledCapital ?? existing.calledCapital.toString(),
    distributionsReceived:
      input.distributionsReceived ?? existing.distributionsReceived.toString(),
    ownershipPercent:
      input.ownershipPercent !== undefined
        ? input.ownershipPercent
        : existing.ownershipPercent !== null
          ? existing.ownershipPercent.toString()
          : null,
    expectedExitDate:
      input.expectedExitDate !== undefined
        ? input.expectedExitDate
        : toIsoDate(existing.expectedExitDate),
    vehicleName: input.vehicleName !== undefined ? input.vehicleName : existing.vehicleName,
    round: input.round !== undefined ? input.round : existing.round,
  });
  const write = await prisma.privateEquityPosition.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Position introuvable");
  const row = await prisma.privateEquityPosition.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Position introuvable");
  return mapRow(row);
}

export async function deletePrivateEquity(userId: string, id: string) {
  const result = await prisma.privateEquityPosition.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Position introuvable");
  return { ok: true };
}

// ─── Historique de valorisation ────────────────────────────────────────────
// Pas d'endpoint pour l'instant : fonctions de service prêtes pour un futur
// branchement API/UI. N'écrivent jamais `currentNav` sur la position — la
// synchronisation entre le dernier point de l'historique et le champ
// "instantané" de la position est laissée à une étape ultérieure.

export type PrivateEquityValuationDto = {
  id: string;
  privateEquityPositionId: string;
  nav: string;
  note: string | null;
  valuedAt: string;
  createdAt: string;
};

type ValuationRow = Prisma.PrivateEquityValuationGetPayload<Record<string, never>>;

function mapValuationRow(row: ValuationRow): PrivateEquityValuationDto {
  return {
    id: row.id,
    privateEquityPositionId: row.privateEquityPositionId,
    nav: row.nav.toString(),
    note: row.note,
    valuedAt: row.valuedAt.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listValuations(
  userId: string,
  positionId: string
): Promise<PrivateEquityValuationDto[]> {
  const position = await prisma.privateEquityPosition.findFirst({
    where: { id: positionId, userId },
  });
  if (!position) throw new Error("Position introuvable");
  const rows = await prisma.privateEquityValuation.findMany({
    where: { privateEquityPositionId: positionId },
    orderBy: { valuedAt: "asc" },
  });
  return rows.map(mapValuationRow);
}

export type PrivateEquityValuationInput = {
  nav: string | number;
  note?: string | null;
  valuedAt: string;
};

export async function addValuation(
  userId: string,
  positionId: string,
  input: PrivateEquityValuationInput
): Promise<PrivateEquityValuationDto> {
  const position = await prisma.privateEquityPosition.findFirst({
    where: { id: positionId, userId },
  });
  if (!position) throw new Error("Position introuvable");
  const valuedAt = parseDate(input.valuedAt);
  if (!valuedAt) throw new Error("Date de valorisation requise");
  const row = await prisma.privateEquityValuation.create({
    data: {
      privateEquityPositionId: positionId,
      nav: dec(input.nav, "0"),
      note: input.note ? String(input.note).trim() : null,
      valuedAt,
    },
  });
  return mapValuationRow(row);
}
