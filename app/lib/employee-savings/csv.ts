/**
 * CSV import/export for employee savings lines.
 * Separator: semicolon (FR) or comma; header row required.
 */

import type { CreateEmployeeSavingsInput } from "./service";
import { normalizeHeader, parseCsv } from "../import/csv-parse";
import { FUND_CATEGORIES as EMPLOYEE_SAVINGS_FUND_CATEGORIES } from "./fund-category";
import {
  EMPLOYEE_SAVINGS_PLAN_TYPES,
  EMPLOYEE_SAVINGS_SOURCES,
  EMPLOYEE_SAVINGS_UNLOCK_MODES,
} from "./types";

export const EMPLOYEE_SAVINGS_CSV_HEADER =
  "plan_type;manager;fund_name;isin;units;nav;currency;source_type;contribution_date;contributed_amount;fund_category;unlock_date;unlock_mode;notes";

export const EMPLOYEE_SAVINGS_CSV_TEMPLATE = `${EMPLOYEE_SAVINGS_CSV_HEADER}
PEE;Amundi;FCPE Actions Monde;FR0010123456;12.5;28.40;EUR;ABONDEMENT;2021-06-15;300;EQUITY;;;Versement intéressement 2021
PEE;Amundi;FCPE Monétaire;FR0010654321;50;10.12;EUR;PARTICIPATION;2022-07-01;480;MONETARY;;;
PER;Natixis Interépargne;FCPE Diversifié;;100;15;EUR;VOLUNTARY;2023-01-10;1400;DIVERSIFIED;;RETIREMENT;PER entreprise
`;

const ALIASES: Record<string, string> = {
  plan_type: "plan_type",
  type: "plan_type",
  type_plan: "plan_type",
  plan: "plan_type",
  manager: "manager",
  gestionnaire: "manager",
  fund_name: "fund_name",
  fond: "fund_name",
  fonds: "fund_name",
  name: "fund_name",
  isin: "isin",
  units: "units",
  parts: "units",
  quantite: "units",
  quantity: "units",
  nav: "nav",
  vl: "nav",
  valeur_liquidative: "nav",
  currency: "currency",
  devise: "currency",
  source_type: "source_type",
  source: "source_type",
  origine: "source_type",
  contribution_date: "contribution_date",
  date_versement: "contribution_date",
  contributed_amount: "contributed_amount",
  montant_verse: "contributed_amount",
  montant: "contributed_amount",
  fund_category: "fund_category",
  categorie: "fund_category",
  famille: "fund_category",
  unlock_date: "unlock_date",
  date_deblocage: "unlock_date",
  unlock_mode: "unlock_mode",
  mode_deblocage: "unlock_mode",
  notes: "notes",
  commentaire: "notes",
};

/**
 * Famille de support déclarée dans le fichier.
 *
 * Rend `null` sur une valeur absente ou inconnue plutôt que « Autres » : la
 * déduction depuis le nom du fonds fera mieux, et « Autres » est un choix,
 * pas un défaut.
 */
function mapFundCategory(raw: string | undefined): string | null {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return null;
  return (EMPLOYEE_SAVINGS_FUND_CATEGORIES as readonly string[]).includes(s)
    ? s
    : null;
}

function mapSource(raw: string): string {
  const s = raw.trim().toUpperCase();
  if ((EMPLOYEE_SAVINGS_SOURCES as readonly string[]).includes(s)) return s;
  if (/volont|voluntary/i.test(raw)) return "VOLUNTARY";
  if (/int[eé]ress/i.test(raw)) return "INTERESTEMENT";
  if (/particip/i.test(raw)) return "PARTICIPATION";
  if (/abond/i.test(raw) || /match/i.test(raw)) return "ABONDEMENT";
  return "VOLUNTARY";
}

function mapPlan(raw: string): string {
  const s = raw.trim().toUpperCase();
  if ((EMPLOYEE_SAVINGS_PLAN_TYPES as readonly string[]).includes(s)) return s;
  if (/perco/i.test(raw)) return "PERCO";
  if (/\bper\b/i.test(raw)) return "PER";
  return "PEE";
}

function mapUnlockMode(raw: string, planType: string): string {
  const s = raw.trim().toUpperCase();
  if ((EMPLOYEE_SAVINGS_UNLOCK_MODES as readonly string[]).includes(s)) return s;
  if (/retrait|retire/i.test(raw)) return "RETIREMENT";
  if (/date/i.test(raw)) return "DATE";
  return planType === "PEE" ? "DATE" : "RETIREMENT";
}

/**
 * Lit un fichier d'épargne salariale.
 *
 * Le découpage, la détection du séparateur, les en-têtes homonymes et les
 * lignes qu'Excel a recollées en une seule cellule sont l'affaire de
 * `app/lib/import/csv-parse.ts` — le même parseur que tous les autres imports.
 * Ce fichier ne garde que ce qui lui est propre : la correspondance des
 * colonnes et la traduction des valeurs en champs métier.
 */
export function parseEmployeeSavingsCsv(text: string): {
  rows: CreateEmployeeSavingsInput[];
  errors: Array<{ line: number; message: string }>;
  delimiter: string;
} {
  // Les commentaires restent hors du parseur : sans en-tête ni colonnes, ils
  // ressortiraient en lignes de données vides, donc en erreurs de lecture.
  const withoutComments = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  const parsed = parseCsv(withoutComments);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: "Fichier vide ou sans données" }],
      delimiter: parsed.delimiter || ";",
    };
  }

  // Le parseur partagé rend les en-têtes tels qu'écrits (dédoublonnés) et
  // indexe chaque ligne par ces en-têtes ; la normalisation et les alias se
  // font donc ici, et le premier en-tête d'une clé l'emporte.
  const headerForKey = new Map<string, string>();
  for (const h of parsed.headers) {
    const norm = normalizeHeader(h);
    const key = ALIASES[norm] || norm;
    if (!headerForKey.has(key)) headerForKey.set(key, h);
  }

  const get = (row: Record<string, string>, key: string): string => {
    const header = headerForKey.get(key);
    if (header === undefined) return "";
    return (row[header] ?? "").trim();
  };

  const rows: CreateEmployeeSavingsInput[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  parsed.rows.forEach((row, i) => {
    // Numérotation relative à l'en-tête : ligne 1 = en-têtes, 2 = 1re donnée.
    const line = i + 2;
    const manager = get(row, "manager");
    const fundName = get(row, "fund_name");
    if (!manager && !fundName) {
      errors.push({ line, message: "Ligne vide ignorée" });
      return;
    }
    if (!manager || !fundName) {
      errors.push({ line, message: "manager et fund_name requis" });
      return;
    }
    const planType = mapPlan(get(row, "plan_type") || "PEE");
    rows.push({
      planType,
      manager,
      fundName,
      isin: get(row, "isin") || null,
      units: get(row, "units") || "0",
      nav: get(row, "nav") || "0",
      currency: get(row, "currency") || "EUR",
      sourceType: mapSource(get(row, "source_type") || "VOLUNTARY"),
      contributionDate: get(row, "contribution_date") || null,
      contributedAmount: get(row, "contributed_amount") || null,
      fundCategory: mapFundCategory(get(row, "fund_category")),
      unlockDate: get(row, "unlock_date") || null,
      unlockMode: mapUnlockMode(get(row, "unlock_mode"), planType),
      notes: get(row, "notes") || null,
    });
  });

  return { rows, errors, delimiter: parsed.delimiter };
}
