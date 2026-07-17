/** Épargne salariale française — types partagés */

export const EMPLOYEE_SAVINGS_PLAN_TYPES = ["PEE", "PER", "PERCO"] as const;
export type EmployeeSavingsPlanType = (typeof EMPLOYEE_SAVINGS_PLAN_TYPES)[number];

export const EMPLOYEE_SAVINGS_SOURCES = [
  "VOLUNTARY",
  "INTERESTEMENT",
  "PARTICIPATION",
  "ABONDEMENT",
] as const;
export type EmployeeSavingsSource = (typeof EMPLOYEE_SAVINGS_SOURCES)[number];

export const EMPLOYEE_SAVINGS_UNLOCK_MODES = ["DATE", "RETIREMENT"] as const;
export type EmployeeSavingsUnlockMode = (typeof EMPLOYEE_SAVINGS_UNLOCK_MODES)[number];

/** Libellés longs (formulaires, légendes) */
export const PLAN_TYPE_LABELS: Record<EmployeeSavingsPlanType, string> = {
  PEE: "PEE — Plan d'épargne entreprise",
  PER: "PER — Plan d'épargne retraite",
  PERCO: "PERCO — Plan d'épargne retraite collectif",
};

/** Libellés courts (tableau, KPI, chips) */
export const PLAN_TYPE_SHORT: Record<EmployeeSavingsPlanType, string> = {
  PEE: "PEE",
  PER: "PER",
  PERCO: "PERCO",
};

export const SOURCE_TYPE_LABELS: Record<EmployeeSavingsSource, string> = {
  VOLUNTARY: "Versements volontaires",
  INTERESTEMENT: "Intéressement",
  PARTICIPATION: "Participation",
  ABONDEMENT: "Abondement employeur",
};

export const UNLOCK_MODE_LABELS: Record<EmployeeSavingsUnlockMode, string> = {
  DATE: "Date fixe",
  RETIREMENT: "Retraite",
};

export const COMMON_MANAGERS = [
  "Amundi",
  "Natixis Interépargne",
  "AXA Épargne Entreprise",
  "Esalia",
  "Eres",
  "BNP Paribas Épargne & Retraite Entreprises",
  "Crédit Agricole Assurances",
  "Groupama Épargne Salariale",
  "CIC Épargne Retraite Entreprises",
  "Crédit Mutuel Épargne Retraite Entreprises",
  "Epsor",
  "Malakoff Humanis Épargne",
  "AG2R La Mondiale Épargne Salariale",
  "Swiss Life Épargne Salariale",
  "Allianz Épargne Salariale",
  "Generali Épargne Salariale",
  "Abeille Assurances",
  "Regard Épargne Salariale",
  "Federal Finance",
  "Autre",
] as const;

export type LiquidityStatus = "AVAILABLE" | "BLOCKED";

export type EmployeeSavingsLineDto = {
  id: string;
  planType: EmployeeSavingsPlanType;
  manager: string;
  fundName: string;
  isin: string | null;
  units: string;
  nav: string;
  currency: string;
  sourceType: EmployeeSavingsSource;
  contributionDate: string | null;
  unlockDate: string | null;
  unlockMode: EmployeeSavingsUnlockMode;
  notes: string | null;
  /** units × nav */
  marketValue: string;
  liquidityStatus: LiquidityStatus;
  unlockLabel: string;
};

export type UnlockTimelineBucket = {
  /** YYYY or "retirement" or "available" */
  key: string;
  label: string;
  amount: string;
  lineCount: number;
};

export type EmployeeSavingsSummary = {
  totalValue: string;
  availableValue: string;
  blockedValue: string;
  availablePct: number;
  blockedPct: number;
  byPlanType: { name: string; planType: string; value: number }[];
  byManager: { name: string; value: number }[];
  bySource: { name: string; sourceType: string; value: number }[];
  unlockTimeline: UnlockTimelineBucket[];
  lineCount: number;
};
