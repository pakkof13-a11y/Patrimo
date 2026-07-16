/**
 * CSV import/export for employee savings lines.
 * Separator: semicolon (FR) or comma; header row required.
 */

import type { CreateEmployeeSavingsInput } from "./service";
import {
  EMPLOYEE_SAVINGS_PLAN_TYPES,
  EMPLOYEE_SAVINGS_SOURCES,
  EMPLOYEE_SAVINGS_UNLOCK_MODES,
} from "./types";

export const EMPLOYEE_SAVINGS_CSV_HEADER =
  "plan_type;manager;fund_name;isin;units;nav;currency;source_type;contribution_date;unlock_date;unlock_mode;notes";

export const EMPLOYEE_SAVINGS_CSV_TEMPLATE = `${EMPLOYEE_SAVINGS_CSV_HEADER}
PEE;Amundi;FCPE Actions Monde;FR0010123456;12.5;28.40;EUR;ABONDEMENT;2021-06-15;;;Versement intéressement 2021
PEE;Amundi;FCPE Monétaire;FR0010654321;50;10.12;EUR;PARTICIPATION;2022-07-01;;;
PER;Natixis Interépargne;FCPE Diversifié;;100;15;EUR;VOLUNTARY;2023-01-10;;RETIREMENT;PER entreprise
`;

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes(";")) return ";";
  if (headerLine.includes("\t")) return "\t";
  return ",";
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/\s+/g, "_");
}

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
  unlock_date: "unlock_date",
  date_deblocage: "unlock_date",
  unlock_mode: "unlock_mode",
  mode_deblocage: "unlock_mode",
  notes: "notes",
  commentaire: "notes",
};

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

export function parseEmployeeSavingsCsv(text: string): {
  rows: CreateEmployeeSavingsInput[];
  errors: Array<{ line: number; message: string }>;
  delimiter: string;
} {
  const lines = text
    .replace(/^\ufeff/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    return { rows: [], errors: [{ line: 0, message: "Fichier vide ou sans données" }], delimiter: ";" };
  }

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map(normHeader);
  const colIndex = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = ALIASES[h] || h;
    if (!colIndex.has(key)) colIndex.set(key, i);
  });

  const get = (cells: string[], key: string) => {
    const i = colIndex.get(key);
    if (i == null) return "";
    return cells[i] ?? "";
  };

  const rows: CreateEmployeeSavingsInput[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li], delim);
    const manager = get(cells, "manager");
    const fundName = get(cells, "fund_name");
    if (!manager && !fundName) {
      errors.push({ line: li + 1, message: "Ligne vide ignorée" });
      continue;
    }
    if (!manager || !fundName) {
      errors.push({ line: li + 1, message: "manager et fund_name requis" });
      continue;
    }
    const planType = mapPlan(get(cells, "plan_type") || "PEE");
    rows.push({
      planType,
      manager,
      fundName,
      isin: get(cells, "isin") || null,
      units: get(cells, "units") || "0",
      nav: get(cells, "nav") || "0",
      currency: get(cells, "currency") || "EUR",
      sourceType: mapSource(get(cells, "source_type") || "VOLUNTARY"),
      contributionDate: get(cells, "contribution_date") || null,
      unlockDate: get(cells, "unlock_date") || null,
      unlockMode: mapUnlockMode(get(cells, "unlock_mode"), planType),
      notes: get(cells, "notes") || null,
    });
  }

  return { rows, errors, delimiter: delim };
}
