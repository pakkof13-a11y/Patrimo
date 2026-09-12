import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import {
  addYears,
  buildUnlockTimeline,
  marketValueOf,
  PEE_LOCK_YEARS,
  planLabel,
  resolveUnlock,
  sourceLabel,
} from "./logic";
import { isFundCategory } from "./fund-category";
import { parseNumber } from "@/app/lib/import/normalize";
import { d, toFixed } from "@/app/lib/money/decimal";
import { convertToEurSync, getEurRates } from "@/app/lib/market/fx";
import type {
  EmployeeSavingsLineDto,
  EmployeeSavingsPlanType,
  EmployeeSavingsSource,
  EmployeeSavingsSummary,
  EmployeeSavingsUnlockMode,
} from "./types";

/** Écriture déjà canonique (`-12.5`, `1e-12`) : aucune ambiguïté à lever. */
const CANONICAL_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Une entrée numérique → Decimal, ou `null` si elle n'est pas lisible.
 *
 * La désambiguïsation des séparateurs est déléguée à `parseNumber`, qui sait
 * que « 1.234,56 » et « 1,234.56 » valent le même nombre. Le `.replace(",", ".")`
 * d'avant ne remplaçait que la première virgule : « 1.234,56 » devenait
 * « 1.234.56 », donc `NaN`, donc — silencieusement — zéro.
 *
 * Une écriture déjà canonique est passée telle quelle au Decimal : le détour
 * par un double y perdrait les chiffres au-delà du 17e, et ces colonnes sont
 * des `Decimal(28, 12)`.
 */
function toDecimal(v: string | number | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (CANONICAL_NUMBER.test(s)) return new Prisma.Decimal(s);
  const n = parseNumber(s);
  return n === null ? null : new Prisma.Decimal(n);
}

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  return toDecimal(v) ?? new Prisma.Decimal(fallback);
}

/**
 * Décimal facultatif : une chaîne vide n'est pas un zéro.
 *
 * Le formulaire envoie "" quand l'utilisateur ne sait pas ; l'enregistrer à 0
 * ferait apparaître un gain égal à la valeur entière de la position.
 */
function optionalDec(v: string | number | null | undefined): Prisma.Decimal | null {
  return toDecimal(v);
}

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function mapLine(row: {
  id: string;
  planType: string;
  manager: string;
  fundName: string;
  isin: string | null;
  units: Prisma.Decimal;
  nav: Prisma.Decimal;
  currency: string;
  sourceType: string;
  contributionDate: Date | null;
  contributedAmount: Prisma.Decimal | null;
  fundCategory: string | null;
  unlockDate: Date | null;
  unlockMode: string;
  notes: string | null;
}, rates: Record<string, number>): EmployeeSavingsLineDto {
  const unlock = resolveUnlock({
    planType: row.planType,
    unlockMode: row.unlockMode,
    unlockDate: row.unlockDate,
    contributionDate: row.contributionDate,
  });
  const units = row.units.toString();
  const nav = row.nav.toString();
  const mv = marketValueOf(units, nav);
  /*
    La devise de la ligne était lue et rendue, jamais appliquée.

    `marketValue` est un produit sans devise ; l'agrégat qui le sommait
    (`summarizeLines`) traitait donc un FCPE en CHF comme un montant en euros.
    La conversion est celle du reste du dépôt — `convertToEurSync(mv,
    r.currency)`, exactement comme `getEmployeeSavingsTotalsEur` dans
    `portfolio/service.ts` — et elle a lieu ici, seul endroit qui dispose des
    taux.

    Les deux champs sont publiés : `marketValue` reste la valeur dans la devise
    du support (c'est ce que la liste affiche, avec son symbole), `marketValueEur`
    est ce que les totaux additionnent. Un seul des deux pouvait être juste.
  */
  const mvEur = d(convertToEurSync(mv, row.currency || "EUR", rates));

  return {
    id: row.id,
    planType: row.planType as EmployeeSavingsPlanType,
    manager: row.manager,
    fundName: row.fundName,
    isin: row.isin,
    units,
    nav,
    currency: row.currency,
    sourceType: row.sourceType as EmployeeSavingsSource,
    contributionDate: toIsoDate(row.contributionDate),
    // Deux champs facultatifs : `null` veut dire « non renseigné », jamais
    // « zéro ». C'est ce qui permet à l'écran de ne pas annoncer un gain qu'il
    // ne peut pas calculer.
    contributedAmount: row.contributedAmount ? row.contributedAmount.toString() : null,
    fundCategory: row.fundCategory,
    unlockDate: unlock.unlockDate ? toIsoDate(unlock.unlockDate) : toIsoDate(row.unlockDate),
    unlockMode: unlock.unlockMode,
    notes: row.notes,
    marketValue: toFixed(mv, 2),
    marketValueEur: toFixed(mvEur, 2),
    liquidityStatus: unlock.liquidityStatus,
    unlockLabel: unlock.unlockLabel,
  };
}

export async function listEmployeeSavings(userId: string): Promise<{
  lines: EmployeeSavingsLineDto[];
  summary: EmployeeSavingsSummary;
}> {
  const [rows, rates] = await Promise.all([
    prisma.employeeSavingsLine.findMany({
      where: { userId },
      orderBy: [{ planType: "asc" }, { manager: "asc" }, { fundName: "asc" }],
    }),
    getEurRates(),
  ]);
  const lines = rows.map((row) => mapLine(row, rates));
  return { lines, summary: summarizeLines(lines) };
}

export function summarizeLines(lines: EmployeeSavingsLineDto[]): EmployeeSavingsSummary {
  let total = 0;
  let available = 0;
  let blocked = 0;
  const byPlan = new Map<string, number>();
  const byManager = new Map<string, number>();
  const bySource = new Map<string, number>();

  const timelineInput: Array<{
    marketValue: number;
    liquidityStatus: "AVAILABLE" | "BLOCKED";
    unlockMode: string;
    unlockDate: Date | null;
  }> = [];

  for (const l of lines) {
    // Les euros, pas la devise du support : additionner `marketValue` mêlait
    // des CHF à des euros dans un total présenté en euros.
    const v = Number(l.marketValueEur) || 0;
    total += v;
    if (l.liquidityStatus === "AVAILABLE") available += v;
    else blocked += v;

    byPlan.set(l.planType, (byPlan.get(l.planType) || 0) + v);
    byManager.set(l.manager, (byManager.get(l.manager) || 0) + v);
    bySource.set(l.sourceType, (bySource.get(l.sourceType) || 0) + v);

    timelineInput.push({
      marketValue: v,
      liquidityStatus: l.liquidityStatus,
      unlockMode: l.unlockMode,
      unlockDate: l.unlockDate ? new Date(l.unlockDate) : null,
    });
  }

  const pct = (part: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

  return {
    totalValue: total.toFixed(2),
    availableValue: available.toFixed(2),
    blockedValue: blocked.toFixed(2),
    availablePct: pct(available),
    blockedPct: pct(blocked),
    byPlanType: [...byPlan.entries()]
      .map(([planType, value]) => ({
        planType,
        name: planLabel(planType),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    byManager: [...byManager.entries()]
      .map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    bySource: [...bySource.entries()]
      .map(([sourceType, value]) => ({
        sourceType,
        name: sourceLabel(sourceType),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    unlockTimeline: buildUnlockTimeline(timelineInput),
    lineCount: lines.length,
  };
}

export type CreateEmployeeSavingsInput = {
  planType: string;
  manager: string;
  fundName: string;
  isin?: string | null;
  units?: string | number;
  nav?: string | number;
  currency?: string;
  sourceType?: string;
  contributionDate?: string | null;
  contributedAmount?: string | number | null;
  fundCategory?: string | null;
  unlockDate?: string | null;
  unlockMode?: string | null;
  notes?: string | null;
};

/** `YYYY-MM-DD`, éventuellement suivi d'une heure dont le jour ne dépend pas. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
/** `JJ/MM/AAAA`, avec `/`, `-` ou `.` comme séparateur. */
const DMY_DAY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/**
 * Date de versement / de déblocage saisie ou importée.
 *
 * `new Date("31/12/2030")` rend `Invalid Date` : le format français, celui
 * qu'écrivent les relevés d'Amundi et de Natixis, repartait donc en `null`.
 * Une ligne perdait sa date de versement — et avec elle son échéance PEE à
 * +5 ans — sans que l'import ne le signale.
 *
 * Les deux formats acceptés sont donc explicites, et tout le reste lève :
 * l'appelant par lot (`importEmployeeSavingsLines`) convertit l'erreur en
 * `{ line, message }`, comme pour un gestionnaire ou un fonds manquant.
 *
 * Le jour est ancré à minuit UTC, comme partout ailleurs dans le module
 * (cf. `startOfDay` de `logic.ts` et `app/lib/dates/day-window.ts`) : un
 * ancrage local ferait basculer la date d'un jour selon le fuseau du serveur.
 */
function parseOptionalDate(v: string | null | undefined, field: string): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  const iso = s.match(ISO_DAY);
  if (iso) {
    const d = utcDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
    throw new Error(`${field} : date inexistante (${s})`);
  }

  const dmy = s.match(DMY_DAY);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    // Même arbitrage que `parseDate` de l'import : le format français est le
    // défaut, et on ne bascule en JJ/MM américain que si le premier nombre ne
    // peut pas être un mois.
    if (month > 12 && day <= 12) {
      const t = day;
      day = month;
      month = t;
    }
    const d = utcDay(Number(dmy[3]), month, day);
    if (d) return d;
    throw new Error(`${field} : date inexistante (${s})`);
  }

  throw new Error(`${field} : format de date non reconnu (${s}) — attendu JJ/MM/AAAA ou AAAA-MM-JJ`);
}

/** Minuit UTC du jour donné, ou `null` si ce jour n'existe pas (31/02). */
function utcDay(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function normalizeCreate(input: CreateEmployeeSavingsInput) {
  const planType = String(input.planType || "PEE").toUpperCase();
  let unlockMode = String(input.unlockMode || "").toUpperCase();
  if (unlockMode !== "DATE" && unlockMode !== "RETIREMENT") {
    unlockMode = planType === "PEE" ? "DATE" : "RETIREMENT";
  }
  const contributionDate = parseOptionalDate(
    input.contributionDate ?? null,
    "Date de versement"
  );
  let unlockDate = parseOptionalDate(input.unlockDate ?? null, "Date de déblocage");

  // Auto PEE unlock if missing — `addYears` est la seule définition du « +5 ans »
  // (elle raisonne en UTC ; `setFullYear` décalait la date d'un jour selon le
  // fuseau du serveur).
  if (unlockMode === "DATE" && !unlockDate && contributionDate && planType === "PEE") {
    unlockDate = addYears(contributionDate, PEE_LOCK_YEARS);
  }
  if (unlockMode === "RETIREMENT") {
    unlockDate = null;
  }

  return {
    planType,
    manager: String(input.manager || "").trim(),
    fundName: String(input.fundName || "").trim(),
    isin: input.isin ? String(input.isin).trim().toUpperCase() || null : null,
    units: dec(input.units, "0"),
    nav: dec(input.nav, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    sourceType: String(input.sourceType || "VOLUNTARY").toUpperCase(),
    contributionDate,
    contributedAmount: optionalDec(input.contributedAmount),
    fundCategory: isFundCategory(
      String(input.fundCategory || "").toUpperCase()
    )
      ? String(input.fundCategory).toUpperCase()
      : null,
    unlockDate,
    unlockMode: unlockMode as EmployeeSavingsUnlockMode,
    notes: input.notes ? String(input.notes) : null,
  };
}

/**
 * Normalise et valide une ligne sans toucher la base.
 *
 * Isolé de `createEmployeeSavingsLine` pour que l'import en masse puisse
 * valider avant d'écrire : les deux chemins appliquent alors exactement les
 * mêmes règles, et un refus reste imputable à sa ligne de CSV.
 */
function prepareCreate(input: CreateEmployeeSavingsInput) {
  const data = normalizeCreate(input);
  if (!data.manager) throw new Error("Gestionnaire requis");
  if (!data.fundName) throw new Error("Nom du fonds requis");
  return data;
}

export async function createEmployeeSavingsLine(userId: string, input: CreateEmployeeSavingsInput) {
  const data = prepareCreate(input);
  const row = await prisma.employeeSavingsLine.create({
    data: { userId, ...data },
  });
  return mapLine(row, await getEurRates());
}

export async function updateEmployeeSavingsLine(
  userId: string,
  id: string,
  input: Partial<CreateEmployeeSavingsInput>
) {
  const existing = await prisma.employeeSavingsLine.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Ligne introuvable");

  const merged: CreateEmployeeSavingsInput = {
    planType: input.planType ?? existing.planType,
    manager: input.manager ?? existing.manager,
    fundName: input.fundName ?? existing.fundName,
    isin: input.isin !== undefined ? input.isin : existing.isin,
    units: input.units !== undefined ? input.units : existing.units.toString(),
    nav: input.nav !== undefined ? input.nav : existing.nav.toString(),
    currency: input.currency ?? existing.currency,
    sourceType: input.sourceType ?? existing.sourceType,
    contributionDate:
      input.contributionDate !== undefined
        ? input.contributionDate
        : toIsoDate(existing.contributionDate),
    contributedAmount:
      input.contributedAmount !== undefined
        ? input.contributedAmount
        : existing.contributedAmount?.toString() ?? null,
    fundCategory:
      input.fundCategory !== undefined ? input.fundCategory : existing.fundCategory,
    unlockDate:
      input.unlockDate !== undefined ? input.unlockDate : toIsoDate(existing.unlockDate),
    unlockMode: input.unlockMode ?? existing.unlockMode,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  };

  const data = normalizeCreate(merged);
  const write = await prisma.employeeSavingsLine.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Ligne introuvable");
  const row = await prisma.employeeSavingsLine.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Ligne introuvable");
  return mapLine(row, await getEurRates());
}

export async function deleteEmployeeSavingsLine(userId: string, id: string) {
  const result = await prisma.employeeSavingsLine.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Ligne introuvable");
  return { ok: true };
}

/**
 * Upsert-ish bulk import: create each row (no silent merge by ISIN to avoid
 * wrong merges).
 *
 * Deux temps, parce que les deux natures d'échec ne se rapportent pas de la
 * même façon :
 *
 * 1. normaliser et valider chaque ligne en mémoire — gestionnaire ou fonds
 *    manquant, date illisible : ce sont les seuls refus imputables à une ligne
 *    précise, et aucun n'a jamais eu besoin de la base pour être connu ;
 * 2. une seule écriture `createMany` pour les lignes retenues, là où la boucle
 *    précédente faisait un aller-retour par ligne (N lignes → 1 requête).
 *
 * `createMany` est un unique INSERT : s'il échoue, il n'a rien écrit. On
 * retombe alors sur des créations ligne à ligne, dans le seul but de rendre
 * l'erreur base imputable à sa ligne. Le rapport `{ line, message }` reste
 * donc celui de l'ancienne boucle, y compris quand une seule ligne sur dix
 * fâche, et une ligne refusée n'empêche jamais les autres d'entrer.
 */
export async function importEmployeeSavingsLines(
  userId: string,
  rows: CreateEmployeeSavingsInput[]
) {
  const errors: Array<{ line: number; message: string }> = [];
  const reason = (e: unknown) => (e instanceof Error ? e.message : "Erreur");

  const pending: Array<{ line: number; data: ReturnType<typeof prepareCreate> }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      pending.push({ line: i + 1, data: prepareCreate(rows[i]) });
    } catch (e) {
      errors.push({ line: i + 1, message: reason(e) });
    }
  }

  if (pending.length === 0) return { created: 0, errors };

  try {
    const write = await prisma.employeeSavingsLine.createMany({
      data: pending.map((p) => ({ userId, ...p.data })),
    });
    return { created: write.count, errors };
  } catch {
    // Le lot n'a rien écrit : on reprend ligne à ligne pour situer l'erreur.
    let created = 0;
    for (const p of pending) {
      try {
        await prisma.employeeSavingsLine.create({ data: { userId, ...p.data } });
        created += 1;
      } catch (e) {
        errors.push({ line: p.line, message: reason(e) });
      }
    }
    // Les refus de validation ont été collectés avant ceux de la base : on
    // rétablit l'ordre des lignes, celui que l'écran d'import affiche.
    errors.sort((a, b) => a.line - b.line);
    return { created, errors };
  }
}
